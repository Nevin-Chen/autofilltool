/**
 * claude-bridge — a local, zero-dependency HTTP shim that lets the autofilltool
 * extension draft answers through your Claude Code subscription instead of a
 * paid API key.
 *
 * Why this exists: the extension already speaks the OpenAI `/v1/chat/completions`
 * shape (its "Ollama (local)" provider). This server impersonates that endpoint
 * and, per request, shells out to the `claude` CLI in headless print mode
 * (`claude -p`). Whatever auth Claude Code is logged in with (your Pro/Max
 * subscription) is what powers the draft. No extension code changes: point the
 * Ollama provider's endpoint at this server.
 *
 * Four deliberate choices worth knowing:
 *  - `--system-prompt` replaces the coding-agent instructions, and `--tools ''`
 *    drops the tool definitions. Both are needed: `--system-prompt` alone still
 *    ships ~13.4k tokens of tools and still leaves the model acting like a
 *    coding agent. With tools off a draft costs ~200 input tokens.
 *  - `--setting-sources ''` stops user/project settings loading, which is what
 *    pulls in ~/.claude/CLAUDE.md. A throwaway temp cwd is NOT enough on its
 *    own: the global CLAUDE.md applies regardless of cwd, and its writing rules
 *    were measurably steering the drafts.
 *  - An OUTPUT_CONTRACT is appended to the system prompt so the model always
 *    returns a draft. Headless has no way to answer a clarifying question, so
 *    "tell me the company and role" would otherwise land in the form field.
 *  - Your writing voice is appended from a file via `--append-system-prompt-file`
 *    (see voice-spec.example.md). The file stays local; it never ships anywhere.
 *
 * Terms-of-service note: driving a Claude *subscription* through a wrapper to
 * power a separate app is a gray area versus its intended interactive use. Use
 * on your own account with that in view. An Anthropic API key sidesteps it.
 *
 * Run:  node bridge/claude-bridge.mjs   (or: npm run bridge)
 * Then in the extension: Options -> AI -> Ollama (local),
 *   endpoint http://localhost:11435, model opus.
 *
 * "opus" resolves to claude-opus-5. The extension's Ollama default model is
 * "llama3.2", which Claude would reject, so resolveModel falls back to
 * DEFAULT_MODEL for anything that is not a Claude alias or id.
 */

import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 11435);
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'opus';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CHILD_TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS || 180_000);
const MAX_BODY_BYTES = 2_000_000;

// Keyed by port so two bridges on different ports can be stopped independently.
// Lives in tmp rather than the repo: it is machine state, not project state, and
// a reboot clearing it is the correct behaviour.
const PID_FILE = path.join(os.tmpdir(), `claude-bridge-${PORT}.pid`);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return err.code === 'EPERM';
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stop whatever bridge is recorded for this port. Works no matter how the
 * server was started (foreground, `&`, nohup, or reparented to init), which
 * plain Ctrl-C does not.
 */
function readPidFile() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

/** Whoever is LISTENing on the port, for bridges started before pid files existed. */
function findListenerByPort(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pid = Number(out.trim().split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    // lsof absent, or nothing listening. Either way there is nothing to stop.
    return 0;
  }
}

/**
 * Guard for the port-based path: the pid file proves ownership, a port does not.
 * Something unrelated could be on 11435 and killing it would be our bug.
 */
function isBridgeProcess(pid) {
  try {
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return cmd.includes('claude-bridge');
  } catch {
    return false;
  }
}

async function stopRunningBridge() {
  let pid = readPidFile();
  if (!pid) {
    pid = findListenerByPort(PORT);
    if (!pid) {
      console.log(`[bridge] nothing running on port ${PORT}.`);
      return false;
    }
    if (!isBridgeProcess(pid)) {
      console.log(
        `[bridge] port ${PORT} is held by pid ${pid}, which is not a claude-bridge ` +
          'process. Leaving it alone.',
      );
      return false;
    }
    console.log(`[bridge] no pid file; found bridge on port ${PORT} via lsof (pid ${pid}).`);
  }
  if (!isAlive(pid)) {
    try {
      unlinkSync(PID_FILE);
    } catch {}
    console.log(`[bridge] stale pid ${pid} cleaned up; port ${PORT} was already free.`);
    return true;
  }

  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 30; i++) {
    if (!isAlive(pid)) {
      console.log(`[bridge] stopped (pid ${pid}), port ${PORT} is free.`);
      return true;
    }
    await delay(100);
  }
  // The graceful path had 3s. Something is wedged, so stop asking.
  process.kill(pid, 'SIGKILL');
  console.log(`[bridge] pid ${pid} ignored SIGTERM; sent SIGKILL. Port ${PORT} is free.`);
  return true;
}

if (process.argv.includes('--stop')) {
  const ok = await stopRunningBridge();
  process.exit(ok ? 0 : 1);
}

// A neutral working directory so `claude -p` does not load this project's
// CLAUDE.md. Defence in depth only; `--setting-sources ''` is what actually
// keeps memory files out of the prompt.
const WORK_DIR = mkdtempSync(path.join(os.tmpdir(), 'claude-bridge-'));

/** In-flight `claude` children, reaped on shutdown. */
const children = new Set();

// Headless single-turn has no way to answer a clarifying question: whatever the
// model emits gets streamed into a job application field. Without this, Claude
// reliably replies "tell me the company and role" and that text lands in the
// textarea. Markdown is banned for the same reason - the target is a plain
// <textarea>, not a renderer.
const OUTPUT_CONTRACT = [
  'You are drafting text that will be pasted directly into a job application form field.',
  'Output only the draft itself. Never ask clarifying questions, and never add a preamble,',
  'commentary, or a note about what you did. Do not use markdown formatting.',
  'If a detail is missing, write around it rather than inventing an employer, title, date, or metric.',
].join(' ');

function resolveVoiceSpec() {
  const explicit = process.env.VOICE_SPEC;
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    console.warn(`[bridge] VOICE_SPEC=${explicit} not found; running without a voice spec.`);
    return null;
  }
  const real = path.join(HERE, 'voice-spec.md');
  if (existsSync(real)) return real;
  // Deliberately NOT falling back to voice-spec.example.md. That file is a
  // template addressed to the user ("Copy this file to...") full of bracketed
  // placeholders; fed to the model as a real system prompt it derails the draft
  // into commentary about this repo instead of a cover letter.
  console.warn(
    '[bridge] No bridge/voice-spec.md found; drafts will use a generic voice. ' +
      'Copy bridge/voice-spec.example.md to bridge/voice-spec.md and fill it with your writing.',
  );
  return null;
}

const VOICE_SPEC_PATH = resolveVoiceSpec();

// Claude Code accepts short aliases (opus/sonnet/haiku, which track the latest
// of each) or full ids (claude-opus-5). The extension's Ollama default is
// "llama3.2", which Claude would reject, so fall back to our default for
// anything non-Claude.
function resolveModel(requested) {
  const m = (requested || '').trim();
  if (!m) return DEFAULT_MODEL;
  if (/^(sonnet|opus|haiku)$/i.test(m)) return m.toLowerCase();
  if (/^claude[-.]/i.test(m)) return m;
  return DEFAULT_MODEL;
}

function collectByRole(messages, role) {
  return messages
    .filter((m) => m && m.role === role && typeof m.content === 'string')
    .map((m) => m.content)
    .join('\n\n');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}

function sendJson(res, status, obj) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function sseChunk(res, model, content) {
  const payload = {
    id: 'chatcmpl-bridge',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// Pull assistant text out of a single stream-json line. We only forward
// text_delta chunks (partial-message streaming); thinking/tool events are
// skipped, and the terminal `result` line is captured as a fallback for when
// partial streaming produced nothing.
function extractFromEvent(obj, state) {
  if (obj.type === 'stream_event' && obj.event) {
    const ev = obj.event;
    if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
      return typeof ev.delta.text === 'string' ? ev.delta.text : '';
    }
    return '';
  }
  if (obj.type === 'result') {
    state.isError = obj.is_error === true || obj.subtype !== 'success';
    if (typeof obj.result === 'string') state.resultText = obj.result;
    if (typeof obj.error === 'string') state.errMsg = obj.error;
  }
  return '';
}

function handleChat(req, res, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: { message: 'invalid JSON body' } });
    return;
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const system = collectByRole(messages, 'system');
  const userPrompt = collectByRole(messages, 'user') || collectByRole(messages, 'assistant');
  if (!userPrompt) {
    sendJson(res, 400, { error: { message: 'no user message provided' } });
    return;
  }
  const model = resolveModel(parsed.model);

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', model,
    // Writing a cover letter needs no tools. Dropping them takes the input from
    // ~13.4k tokens to ~200 and stops the model behaving like a coding agent.
    '--tools', '',
    // Empty sources = don't load user/project/local settings, which is what
    // pulls in ~/.claude/CLAUDE.md. Auth is stored separately and still applies.
    '--setting-sources', '',
  ];
  args.push('--system-prompt', system ? `${system}\n\n${OUTPUT_CONTRACT}` : OUTPUT_CONTRACT);
  if (VOICE_SPEC_PATH) args.push('--append-system-prompt-file', VOICE_SPEC_PATH);

  const child = spawn(CLAUDE_BIN, args, { cwd: WORK_DIR, env: process.env });
  // A `claude` child outlives its parent if we exit without reaping it, and it
  // holds a subscription slot while it runs. Track it so shutdown can kill it.
  children.add(child);
  child.once('close', () => children.delete(child));

  const state = { started: false, emitted: 0, resultText: '', isError: false, errMsg: '' };
  let stderr = '';
  let stdoutBuf = '';
  let finished = false;

  const killTimer = setTimeout(() => {
    if (!finished) child.kill('SIGKILL');
  }, CHILD_TIMEOUT_MS);

  const startStream = () => {
    if (state.started) return;
    state.started = true;
    setCors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
  };

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return;
    }
    const text = extractFromEvent(obj, state);
    if (text) {
      startStream();
      sseChunk(res, model, text);
      state.emitted += text.length;
    }
  };

  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString('utf8');
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      handleLine(stdoutBuf.slice(0, nl));
      stdoutBuf = stdoutBuf.slice(nl + 1);
    }
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString('utf8');
  });

  const finalize = () => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    if (stdoutBuf.trim()) handleLine(stdoutBuf);

    if (state.started) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (!state.isError && state.resultText) {
      startStream();
      sseChunk(res, model, state.resultText);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const message =
      state.errMsg || stderr.trim() || 'claude exited without producing output';
    sendJson(res, 500, { error: { message } });
  };

  child.on('error', (err) => {
    state.errMsg = err.code === 'ENOENT' ? `claude CLI not found (${CLAUDE_BIN})` : err.message;
    finalize();
  });
  child.on('close', finalize);

  req.on('close', () => {
    if (!finished) child.kill('SIGKILL');
  });

  child.stdin.on('error', () => {});
  child.stdin.write(userPrompt);
  child.stdin.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    sendJson(res, 200, { status: 'ok', model: DEFAULT_MODEL, voiceSpec: Boolean(VOICE_SPEC_PATH) });
    return;
  }
  if (req.method === 'POST' && req.url && req.url.startsWith('/v1/chat/completions')) {
    try {
      const body = await readBody(req);
      handleChat(req, res, body);
    } catch (err) {
      sendJson(res, 400, { error: { message: err instanceof Error ? err.message : String(err) } });
    }
    return;
  }
  sendJson(res, 404, { error: { message: `no route for ${req.method} ${req.url}` } });
});

let shuttingDown = false;

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[bridge] ${reason}, shutting down.`);

  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
  children.clear();
  try {
    unlinkSync(PID_FILE);
  } catch {}
  try {
    rmSync(WORK_DIR, { recursive: true, force: true });
  } catch {}

  server.close(() => process.exit(0));
  // An open SSE stream keeps server.close() pending indefinitely, so do not wait
  // on it. Unref'd because the sockets themselves hold the loop open until then.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[bridge] port ${PORT} is already in use.`);
    console.error('[bridge] free it with:  npm run bridge:stop');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  writeFileSync(PID_FILE, String(process.pid));
  console.log(`[bridge] listening on http://localhost:${PORT}  (pid ${process.pid})`);
  console.log(`[bridge] model: ${DEFAULT_MODEL}   voice spec: ${VOICE_SPEC_PATH || '(none)'}`);
  console.log(`[bridge] point the extension's Ollama endpoint at http://localhost:${PORT}`);
  console.log('[bridge] stop with Ctrl-C, or `npm run bridge:stop` from anywhere.');
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn(
      '[bridge] ANTHROPIC_API_KEY is set in this environment. Claude Code may bill the ' +
        'API instead of your subscription. Unset it to force subscription auth.',
    );
  }
});
