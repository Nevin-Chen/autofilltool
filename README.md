# AutoFillTool

A somewhat lazy tool to make the most out of local models and AI subscriptions for customized outputs on job applications.

## Links

- [Claude Code bridge setup](bridge/README.md)

## Features

#### **Auto-fill**
- Per-ATS selectors for Greenhouse, Lever, Ashby, Workday, JazzHR, and Workable, with a heuristic fallback for anything else
- Phone fields that come with their own country dropdown get the country picked and only the national number typed, so the dial code isn't doubled
- Location fields with a "Locate me" button use the button, and fall back to your saved city if the browser won't hand over a location
- Skips fields that already have a value. **Force overwrite** if you want it to go over them again
- Fills ATS iframes embedded in company career pages, not just the ATS domain itself
- Filled fields flash so you can see what it touched

#### **Résumé Attachment**
- PDF, DOCX, or TXT up to 5 MB. Stored locally, attached to the file input as if you picked it yourself
- Keep up to 5 labelled résumés (backend, ML, new grad) and mark one as the default
- Pick a different one for a company in the popup and it sticks: the next posting from that company uses the same résumé

#### **AI Suggest**
- Adds a "Suggest" textarea form fields
- It reads the job description off the page, the text out of your résumé, and your profile before writing
- Five providers: OpenAI, Anthropic, Gemini, Ollama, or your Claude Code subscription through the local bridge

#### **Voluntary Self-Identification**
- Save gender, pronouns, Hispanic/Latino, race, sexual orientation, transgender identity, veteran and disability status once, in Options
- Forms word these questions their own way ("Male" in your profile against a list of Man / Woman / Non-binary), so a saved answer is matched to whichever option the form offers rather than typed in literally
- Nothing here is ever guessed. Leave an answer blank and the field is left for you, unless you opt in to letting the AI pick the decline option

#### **Submission Tracking**
- Every apply goes to local history, browsable from the popup, exportable to CSV
- Optional push to a Google Sheet you own, via Apps Script
- Optional auto-log that watches for your submission to go through and logs it for you

#### **Safety**
- The filler refuses to click anything labelled Submit, Apply now, or Send application
- Adapters only detect. They never write to storage and never touch the network

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Platform** | Chrome Manifest V3 |
| **Language** | TypeScript 5.5 (strict) |
| **UI** | React 18, Tailwind CSS 3.4 |
| **Build** | Vite 5, @crxjs/vite-plugin |
| **Validation** | Zod 3 |
| **Storage** | `chrome.storage.local` |
| **Résumé Parsing** | pdfjs-dist (PDF), mammoth (DOCX) |
| **Content Extraction** | Mozilla Readability |
| **AI Providers** | OpenAI, Anthropic, Gemini, Ollama, Claude Code bridge |
| **Testing** | Vitest, jsdom, Playwright |

## Architecture

**Fill flow:**
- Popup → background worker → content script injected into every frame
- The background picks which frames to fill: if a subframe is an ATS host, only those get it, so the company's newsletter signup on the parent page is left alone
- Each frame picks an adapter, classifies its fields, then writes through the native value setter so React's value tracker fires

**AI Suggest flow:**
- Content script opens a long-lived `ai-suggest` port to the background worker
- The background worker is the only code that talks to an outside host. It builds the prompt from your résumé text, the job description, and your profile, then streams the tokens back
- Nothing goes out unless you picked a provider and granted its host permission

**Submission logging:**
- "Mark submitted" (or the opt-in submit watcher) writes to local history, and POSTs to your Apps Script webhook if you set one up

## Prerequisites

- Node 20+
- Google Chrome
- Optional, for local AI: [Ollama](https://ollama.com), or Claude Code logged in with a Pro/Max subscription

## Local Development Setup

1. **Clone and install**
   ```bash
   git clone git@github.com:Nevin-Chen/autofilltool.git
   cd autofilltool
   npm install
   ```

2. **Build**
   ```bash
   npm run build
   ```

3. **Load in Chrome**

   `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/`

4. **Set up your profile**

   Right-click the extension icon → **Options** → fill in your profile and upload a résumé.

5. **Use it**

   Open a job application, click the extension icon → **Fill this page**. Check what it filled, draft any open-ended answers with ✨, then submit it yourself.

For a distributable zip: `npm run package`.

### Watch mode

```bash
npm run dev
```

Vite 5 restricts its dev-server CORS allowlist to local HTTP origins, which blocks the service worker from fetching `@vite/env`. `vite.config.ts` allows `chrome-extension://*` so HMR works. Start `npm run dev` **before** reloading the extension. If that trips you up, `npm run build` produces a static `dist/` that needs no dev server.

## AI Provider Setup

**Options → AI suggestions** → pick a provider, paste a key if it needs one, click **Grant permission**, then **Test**.

| Provider | Default model | Key |
|----------|--------------|-----|
| OpenAI | `gpt-4o-mini` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic | `claude-3-5-haiku-20241022` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| Google Gemini | `gemini-2.5-flash` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| Ollama | `llama3.2` | none, install [ollama.com](https://ollama.com) → `ollama pull llama3.2` |
| Claude Code (local bridge) | `opus` | none, uses your subscription |

### Claude Code Bridge

Drafts through your Claude Code subscription instead of a paid API key, in a writing voice you define. It does **not** use Ollama.

```bash
npm run bridge         # start on http://localhost:11435
npm run bridge:stop    # stop it from anywhere
```

Then pick **Claude Code (local bridge)** in Options. Endpoint and model prefill. Full setup, including the writing-voice spec, is in [bridge/README.md](bridge/README.md).

### What gets sent to the provider

- The question and label from the page
- Company, role, and job URL if the adapter could read them
- A short profile summary (name, links, saved answers, cover-letter blurb, and self-identification answers when a form asks for them)
- Extracted résumé text
- The scraped job description

Nothing leaves the extension except that one request, to the provider URL you granted permission for.

## Google Sheets Logging (optional)

Forwards each tracked submission to a Google Sheet via an Apps Script web app **you own**. Nothing is sent unless you set it up. Create a Sheet, add an Apps Script `doPost` web app deployed as "Anyone with the link", then paste the `/exec` URL into **Options → Tracking** and click **Test**.

## Testing

```bash
npm test           # vitest run
npx tsc --noEmit   # type-check only
npm run lint       # eslint
```

### Environment Variables

The extension itself needs none. Everything you configure lives in the Options page and is stored in `chrome.storage.local`.

The Claude Code bridge reads these, all optional:

```bash
PORT=11435                          # port to listen on
CLAUDE_MODEL=opus                   # model when the extension sends a non-Claude name
VOICE_SPEC=bridge/voice-spec.md     # path to your writing-voice spec
CLAUDE_BIN=claude                   # path to the claude CLI if not on PATH
BRIDGE_TIMEOUT_MS=180000            # kill a draft that runs longer than this
```

## Permissions

**Required**

| Permission | Why |
|------------|-----|
| `storage` | Persist profile, settings, résumés, and history locally |
| `scripting` | Inject the filler into pages when you click Fill |
| `activeTab` | Reach the currently focused tab from the popup |
| Host: ATS domains | Auto-detect Greenhouse, Lever, Ashby, Workday, JazzHR, and Workable forms |

**Optional**, asked for when you need them and revocable from Options:

| Host | Why |
|------|-----|
| `script.google.com`, `script.googleusercontent.com` | Apps Script webhook for Sheets logging |
| `api.openai.com` | OpenAI streaming endpoint |
| `api.anthropic.com` | Anthropic `/v1/messages` streaming endpoint |
| `generativelanguage.googleapis.com` | Google Gemini |
| `http://localhost/*`, `http://127.0.0.1/*` | Ollama (11434) or the Claude Code bridge (11435) |

No `tabs`, no `webRequest`, no broad host access beyond the ATS list.

## Privacy

- API keys, webhook URLs, and résumé bytes live in `chrome.storage.local`, never `chrome.storage.sync`
- No analytics, no telemetry, no remote error reporting
- AI requests go straight from your browser to the provider you picked
- The webhook POSTs only to the URL you paste in

## Project Layout

```
src/
├── background/   MV3 service worker (the only code that talks to external hosts)
├── content/      Injected scripts: filler, AI suggest, submit-watch, overlay
├── adapters/     Per-ATS detection (Greenhouse / Lever / Ashby / Workday / JazzHR / Workable + generic)
├── ai/           Provider dispatch, SSE parser, résumé text extraction
├── profile/      Zod schemas, chrome.storage.local wrapper, migrations
├── tracking/     Sheets webhook client
├── lib/          Messaging, events, permissions, logger, history export
├── types/        Shared message envelope
└── ui/           React + Tailwind options page and popup
bridge/           Local Claude Code subscription bridge (not part of the extension build)
```

## Roadmap

- Per-site allowlist for persistent injection without a click
- Cache the job description across Workday's multi-page wizard
- Single-source-of-truth versioning across `package.json`, `manifest.json`, and `package-lock.json`

## Notes

Three rules I stuck to:

- **Local-first.** No backend ships with the extension. The only network calls are the page you're on, the AI provider you picked, and your own Apps Script webhook.
- **User-in-the-loop.** The filler never clicks Submit. `SUBMIT_DENY` in `src/content/filler.ts` is what enforces it.
- **Safe autofill.** Skip non-empty fields by default, write through the native value setter so React registers the change, then dispatch `input` → `change` → `blur`.

## Author

**Author:** [Nevin Chen](https://linkedin.com/in/nevin-chen) | [Portfolio](https://nevinchen.dev)
