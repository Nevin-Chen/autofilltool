# Claude subscription bridge

A small local server that lets autofilltool draft cover letters and open-ended
answers through your **Claude Code subscription** instead of a paid API key,
in your own writing voice.

It impersonates the OpenAI `/v1/chat/completions` endpoint the extension already
knows how to call (its "Ollama (local)" provider), and for each request shells
out to the `claude` CLI in headless mode. Whatever your Claude Code is logged in
with powers the draft.

## Why a bridge at all

Claude.ai's writing-styles feature is web-app only. It is not exposed through the
API or as a toggle you can call from an extension. So there is no way to "use my
subscription's voice" directly. This bridge does the two things that are actually
available: it routes drafts through your subscription (via the `claude` CLI), and
it prepends a voice spec you author from your own writing (which is what the
styles feature does under the hood anyway).

## Requirements

- Node 18+ (uses only built-in modules, no `npm install` for the bridge).
- Claude Code installed and logged in with your subscription:
  ```bash
  claude          # then run /login and choose your Pro/Max account
  ```
- Make sure `ANTHROPIC_API_KEY` is **not** set in the shell you run the bridge
  from, or Claude Code may bill the API instead of your subscription. The bridge
  warns on startup if it sees one.

## Set up your voice (do this first)

`bridge/voice-spec.md` already exists, built from `~/.claude/skills/writing-style`.
It is deliberately **sample-dominant**: about 3.4k chars of real writing against
2k of guidance. That ratio is the point. The extension's own system prompt
already bans em dashes, buzzwords, and applause endings, and the model ignored
all three when it had no real writing to match against. Adding more rules does
not fix jargon. Adding samples does.

So when a draft sounds off, **add a sample, do not add a rule.**

The biggest remaining gap is marked in the file: there is no real cover letter in
it. Everything is either casual-register chat or one pitch doc, so the model is
extrapolating formal prose from informal samples. Paste in one letter you
actually submitted and it will do more than anything else you can change.

`voice-spec.md` is gitignored and never leaves your machine.

If the file is missing, the bridge runs **without** a voice spec and says so on
startup. It deliberately does not fall back to `voice-spec.example.md`: that
template is addressed to you ("Copy this file to..."), and feeding its bracketed
placeholders to the model as a real system prompt makes it write commentary
about this repo instead of a cover letter.

## Run it

```bash
npm run bridge
# or: node bridge/claude-bridge.mjs
```

You should see:

```
[bridge] listening on http://localhost:11435  (pid 81677)
[bridge] model: opus   voice spec: .../bridge/voice-spec.md
[bridge] stop with Ctrl-C, or `npm run bridge:stop` from anywhere.
```

## Stopping it

```bash
npm run bridge:stop
```

Ctrl-C works too, but only in the terminal that owns the process. `bridge:stop`
works from anywhere, including on a bridge you backgrounded with `&` or `nohup`
and no longer have a terminal for.

Either path kills any in-flight `claude` child (it would otherwise outlive the
server and keep holding a subscription slot), removes the temp working
directory, and deletes the pid file.

Starting a second bridge on a busy port prints the fix instead of a raw stack
trace:

```
[bridge] port 11435 is already in use.
[bridge] free it with:  npm run bridge:stop
```

`bridge:stop` finds the server by pid file (`$TMPDIR/claude-bridge-<port>.pid`),
and falls back to `lsof` on the port if that file is missing. It will not kill a
port holder it cannot confirm is a claude-bridge process, so an unrelated server
on 11435 is reported and left alone.

## Point the extension at it

In the extension's Options page, under **AI suggestions**:

1. Provider: **Ollama (local)**.
2. Endpoint: `http://localhost:11435`
3. Model: `opus` (resolves to `claude-opus-5`). `sonnet` and `haiku` also work.
   Leaving the field at the extension's `llama3.2` default is fine too: the
   bridge falls back to `opus` for any non-Claude model name.
4. Click **Grant permission** for the endpoint, then **Test**. You should get a
   short reply back.

Now the Suggest / Autofill buttons draft through Claude, in your voice. The
extension still never clicks Submit; you review and send.

## How it works

Per request the bridge runs, roughly:

```bash
claude -p \
  --output-format stream-json --include-partial-messages --verbose \
  --model opus \
  --tools '' \
  --setting-sources '' \
  --system-prompt "<the extension's system prompt> + <output contract>" \
  --append-system-prompt-file bridge/voice-spec.md
# user question is piped in on stdin
```

- **`--system-prompt`** replaces the Claude Code coding-agent instructions, so
  your letters are not written by "a software engineer".
- **`--tools ''`** drops every tool definition. This matters more than it looks:
  with `--system-prompt` alone, a draft still costs about **13,400 input tokens**
  of tool schemas and the model still behaves like a coding agent. With tools
  off the same draft costs about **200**.
- **`--setting-sources ''`** stops user, project, and local settings loading,
  which is what pulls in `~/.claude/CLAUDE.md`. The throwaway temp cwd is not
  enough by itself: the global `CLAUDE.md` applies regardless of directory, and
  its writing rules were measurably steering the drafts. Auth is stored
  separately and still works.
- An **output contract** is appended to the system prompt. Headless mode is
  single-turn, so a clarifying question ("tell me the company and role") is not
  a question, it is text that lands in the form field. The contract forces a
  draft and bans markdown, since the target is a plain `<textarea>`.
- Token deltas are streamed straight back to the extension as they arrive.
  Thinking blocks are parsed and discarded.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Options **Test** says "Test timed out after 20s" | That cap is in the extension (`AISection.tsx`), not the bridge. Measured on `opus`: 2-5s for the short test prompt, ~5.6s for a full draft, so a timeout means the CLI is stuck, not slow. |
| Draft mentions this repo, or asks you for the company name | You are running an old copy of the bridge without the output contract, or `voice-spec.md` contains unfilled `[bracketed]` placeholders. |
| `claude CLI not found (claude)` | Set `CLAUDE_BIN` to the full path, e.g. `/opt/homebrew/bin/claude`. |
| Drafts sound like a coding agent | Check the startup log actually points at this version; `--tools ''` is what fixes it. |

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `11435` | Port to listen on (11434 is Ollama's). |
| `CLAUDE_MODEL` | `opus` | Model used when the extension does not send a Claude model. |
| `VOICE_SPEC` | `bridge/voice-spec.md` | Path to your voice spec. |
| `CLAUDE_BIN` | `claude` | Path to the `claude` CLI if it is not on `PATH`. |
| `BRIDGE_TIMEOUT_MS` | `180000` | Kill a draft that runs longer than this. |

`PORT` applies to `bridge:stop` too, since the pid file is keyed by port:
`PORT=11500 npm run bridge:stop`.

## Terms of service

Driving a Claude *subscription* through a wrapper to power a separate app is a
gray area versus its intended interactive use, with account-level enforcement
risk. Run it on your own account with that in mind. If you would rather not,
an Anthropic API key (Options -> AI -> Anthropic) costs a cent or two per letter
and is fully supported.
