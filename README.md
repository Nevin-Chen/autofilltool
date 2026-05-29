# AutoFillTool

A Manifest V3 Chrome extension that autofills common job-application fields
and keeps you in control of the final Submit click. **Local-first**: nothing
leaves your machine unless you explicitly configure an AI provider or a
tracking webhook.

This repo is built in shippable increments. See `Roadmap` below for what
exists today and what's coming.

## Status

**v0.11.0 — Steps 1 + 2 + 3 + 4 + 5 + 6 + 7 of 8: skeleton + generic fill + resume upload (with PDF/DOCX text extraction for AI context) + ATS adapters (Greenhouse — legacy `boards.greenhouse.io` AND the new `job-boards.greenhouse.io` Next.js redesign, both standalone and iframe-embedded — / Lever / Ashby / **Workday** with virtualised-dropdown support) + AI suggestions grounded in profile + parsed résumé + scraped job description (OpenAI / Anthropic / Gemini / Ollama) + Google Sheets logging.**

What works:

- Manifest V3 with minimum permissions (`storage`, `scripting`, `activeTab`).
- TypeScript + Vite + `@crxjs/vite-plugin` build.
- Profile / Settings / Resume / History schemas (zod) with a `schemaVersion`
  migration hook.
- `chrome.storage.local` wrapper with safe-parsing reads and a bounded
  history ring.
- Typed message envelope between popup, content scripts, and the service
  worker.
- React + Tailwind options page with a working profile editor.
- React + Tailwind popup with a working **"Fill this page"** button.
- **Generic adapter** that classifies fields via `autocomplete`, input
  `type`, label / aria / placeholder / name / id keywords, plus
  `<fieldset><legend>` for radio groups.
- **Per-platform adapters** for Greenhouse (`#first_name`/`#last_name`/
  `#email`/`#phone`/`#resume`), Lever (canonical `name="…"` and
  `urls[LinkedIn|GitHub|Portfolio]`), Ashby
  (`[data-testid="FieldEntry"]` walks with structured `FieldLabel`
  classification), and **Workday** (`data-automation-id` selectors plus
  virtualised-dropdown click-popup-click for country/state pickers).
  Each overrides `fillResume` with the platform's exact slot before
  falling back to the shared finder.
- **Embedded ATS iframes** — when a company embeds a Greenhouse / Lever /
  Ashby application form into its own career page (`<iframe src=
  "https://boards.greenhouse.io/embed/…">`), Fill from the popup now
  injects into every frame on the tab (via `chrome.scripting` +
  `allFrames`) and broadcasts FILL_PAGE only to the frames whose URL is a
  known ATS host. Means the actual job form gets the platform adapter
  while the parent page's newsletter signup, analytics iframes, etc. are
  left alone. activeTab still gates the cross-origin injection — no new
  permissions.
- **Safe filler** primitives: native-setter writes (React notices),
  `input`/`change`/`blur` event dispatch, value-then-text option matching for
  `<select>`, click-only-if-state-differs for checkboxes & radios, denylist
  that refuses to click anything labeled "Submit", "Apply now", etc.
- **Skip-if-filled** by default; **"Force overwrite"** toggle in Options
  changes that.
- Persistent shadow-DOM **pill** on every fill: `via <adapter>` plus
  filled / skipped / failed counts, plus a **Mark submitted** button that
  opens a tiny inline form (company / role / job URL pre-filled from page
  metadata) and POSTs the record to your Google Sheet.
- **Sheets logging** — paste an Apps Script web-app URL in Options, grant
  per-origin host permission, hit **Send test ping** to verify. Every
  Mark-submitted click appends a row in your sheet and stores the entry in
  local history regardless of webhook success.
- **Recent submissions** list in the popup (last 5).
- **Resume upload** in Options (`.pdf`, `.doc`, `.docx`, `.txt`, ≤ 5 MB),
  stored locally as base64 and reconstructed into a real `File` at fill
  time. The generic adapter finds the resume slot via label / name / aria /
  accept hints (or falls back to the only file input on the page) and
  attaches the file via a `DataTransfer` so the host page sees it like a
  real picker selection. The pill summary now shows `Resume attached` or
  `Resume: no slot on this page`.
- **AI suggestions** — a ✨ Suggest button is injected next to every
  detected open-ended textarea after Fill. Click streams a draft answer
  straight into the textarea via the safe filler (so React notices). Pick
  OpenAI, Anthropic, **Google Gemini (free tier)**, or
  **Ollama (fully local, no key, open-weight models)** in Options, paste
  your own API key (or just install Ollama), grant per-host permission.
  The prompt is grounded in three context blocks the agent needs to
  answer well: the **question text** from the textarea, the **job
  description** scraped from the posting (per-ATS adapter selectors with
  Mozilla Readability as the generic fallback), and the **user's résumé
  text** (PDF parsed with pdfjs-dist, DOCX with mammoth, plain text
  inline). The model is instructed to mirror the posting's vocabulary
  where the user's actual experience supports it, and not to invent
  facts. Test button in Options does a one-shot round-trip to confirm
  the setup works.
- 173 vitest unit tests covering schema, migrations, filler (including the
  new virtualised-dropdown async helper), generic adapter, per-platform
  adapters (Greenhouse classic + new redesign, Lever, Ashby, Workday),
  webhook client, job-context, resume round-trip, the SSE parser, all four
  AI provider streamers (OpenAI / Anthropic / Gemini / Ollama), the prompt
  builder including the job-description block, résumé text extraction
  for plain text + real PDF fixture (round-trip "Hello world!") + DOCX
  placeholder fallback, multi-frame targeting + response merger, the
  DOM-probe ATS hint detector, and per-adapter `getJobDescription`
  selectors plus the Readability fallback.

What is intentionally **not** here yet:

- Encrypted profile export/import (step 8).

## Develop

Requires Node 20 or newer.

```bash
npm install
npm run dev      # Vite watch mode; writes to dist/
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin the extension and open the popup. You should see `Background: alive`.
5. Right-click the icon → **Options** to edit your profile.

The watch build will rebuild on save; click the extension's reload arrow on
`chrome://extensions` to pick up changes.

> **Dev-mode CORS note.** Vite 5 restricts its dev server CORS allowlist to
> local HTTP origins, which blocks the extension's service worker from
> fetching `@vite/env`. This repo's `vite.config.ts` allows
> `chrome-extension://*` so HMR works out of the box. If you still see
> `Service worker registration failed. Status code: 3`, make sure the
> `npm run dev` server is running **before** you reload the extension, then
> hit the reload arrow on `chrome://extensions`.
>
> Prefer a friction-free setup? `npm run build` produces a fully static
> `dist/` you can load and reload without a dev server.

## Build for distribution

```bash
npm run build    # type-checks then produces dist/
npm run package  # zips dist/ to autofilltool.zip for the Chrome Web Store
```

## Google Sheets logging

The extension can optionally append each "Mark submitted" click to a Google
Sheet via a Google Apps Script web app you own. Nothing is sent unless you
configure this — no third party is involved.

### 1. Create the receiving Apps Script

Open the sheet you want to log to. In Google Sheets:

`Extensions → Apps Script → paste the code below → Save → Deploy → New deployment`

Pick **Web app** as the type, set "Execute as: Me" and "Who has access:
Anyone", deploy, and copy the **Web app URL**.

```js
// AutoFillTool — Apps Script receiver.
// Appends one row per submission to the active sheet.
// Headers (row 1) are created the first time data lands.

const HEADERS = ['timestamp', 'company', 'role', 'jobUrl', 'source', 'status', 'note', 'id'];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders_(sheet);

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Invalid JSON' }, 400);
  }

  // Ignore test pings (Options → Send test ping) — just confirm reachability.
  if (payload && payload.test === true) {
    return jsonResponse_({ ok: true, test: true });
  }

  const s = payload && payload.submission;
  if (!s) return jsonResponse_({ ok: false, error: 'Missing submission' }, 400);

  sheet.appendRow([
    s.timestamp || new Date().toISOString(),
    s.company || '',
    s.role || '',
    s.jobUrl || '',
    s.source || '',
    s.status || '',
    s.note || '',
    s.id || '',
  ]);

  return jsonResponse_({ ok: true });
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
}

function jsonResponse_(obj, status) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### 2. Configure the extension

1. Open the extension's **Options** page.
2. Scroll to **Tracking (optional)**.
3. Paste the web-app URL.
4. Click **Grant permission** — Chrome will prompt to allow the extension to
   make requests to `script.google.com` and `script.googleusercontent.com`.
   The permission is per-origin and stored locally; you can revoke it from
   the same page.
5. Click **Send test ping**. You should see `Test ping succeeded`.

### 3. Log a submission

On any job page, click **Fill this page** from the popup. The persistent
pill in the bottom-right gives you a **Mark submitted** button. The form
pre-fills `company`, `role`, and `jobUrl` from the page — edit if needed,
hit **Send**, and the row appears in your sheet.

The payload shape is:

```json
{
  "source": "autofilltool",
  "version": 1,
  "submission": {
    "id": "uuid",
    "timestamp": "2026-05-24T12:34:56.000Z",
    "company": "Acme",
    "role": "Senior Backend Engineer",
    "jobUrl": "https://boards.greenhouse.io/acme/jobs/123",
    "source": "generic",
    "status": "submitted",
    "note": ""
  }
}
```

### Privacy & failure handling

- The webhook URL is stored only in `chrome.storage.local`, never synced.
- Submissions always land in local history. The webhook POST is best-effort:
  one retry on network error, then it surfaces the failure in the pill.
  Your local history is never blocked on the webhook.
- Apps Script web apps deployed with "Anyone" access are anonymous — they
  can't trace requests back to you beyond the script owner's account.

## AI suggestions

A ✨ Suggest button appears next to every detected open-ended `<textarea>`
after you click Fill. Click it to stream a draft answer straight into the
field. Click again while streaming to cancel.

### Setup

1. Options → **AI suggestions (optional)**.
2. Pick a provider:
   - **OpenAI** — pay-as-you-go API. Default model: `gpt-4o-mini`. Key
     from [platform.openai.com](https://platform.openai.com/api-keys).
   - **Anthropic** — pay-as-you-go API. Default model:
     `claude-3-5-haiku-20241022`. Key from
     [console.anthropic.com](https://console.anthropic.com/settings/keys).
   - **Google Gemini** — has a genuine (rate-limited, no
     card required to start). Default model: `gemini-2.5-flash`. Key from
     [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
     Uses Google's OpenAI-compatible endpoint, so the same streaming code
     path serves all three providers.
   - **Ollama (local)** — runs entirely on your machine, no key, no
     network. Install [Ollama](https://ollama.com), then
     `ollama pull llama3.2` (the default — Meta's 3B model, well-aligned,
     runs on most laptops). Heavier alternatives like `llama3.1:8b`,
     `qwen2.5:7b`, or `gemma2:2b` all work — just type the model name in
     Options. The Ollama daemon listens on `http://localhost:11434` by
     default; point at a LAN host if you run Ollama on a different
     machine. Same OpenAI-compatible code path.
3. Paste your own API key (skip for Ollama). Keys live in
   `chrome.storage.local`, never `chrome.storage.sync`.
4. Click **Grant permission** so the background worker can reach the
   provider's API host (one prompt per provider, including localhost for
   Ollama).
5. Click **Test** to confirm the setup works end-to-end.

### What gets sent to the provider

Each Suggest click sends:

- The question text and label from the page.
- Company + role + job URL if the adapter could read them.
- A short bullet summary of your profile (name, links, prior saved answers,
  cover-letter blurb).
- The résumé, if it's a `.txt` file — `.pdf` / `.docx` go as a
  filename-only note for now (no parser bundled).
- The system prompt explicitly forbids inventing companies, dates, titles,
  or skills the profile doesn't mention.

Nothing leaves the background worker except for the streaming request to
the URL you authorised. Responses are not cached unless you tick
**Cache responses locally** in Options.

### Streaming under the hood

Chrome's `runtime.sendMessage` doesn't support streaming, so the content
script opens a long-lived `Port` named `ai-suggest`. The background routes
through `src/ai/client.ts` → `src/ai/providers/{openai,anthropic,gemini,ollama}.ts`,
parses SSE with `src/ai/sse.ts`, and posts one `{kind:"delta",text}`
message per chunk. Each delta hits the textarea through the same native
setter the safe filler uses, so frameworks like React register every
keystroke. OpenAI, Gemini, and Ollama all share `openai-compat.ts` — only
the URL and auth header differ.

## Permissions

| Permission                           | Why                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `storage`                            | Persist profile, settings, resume, and history in `chrome.storage.local`.      |
| `scripting`                          | Inject the filler into pages on user request.                                  |
| `activeTab`                          | Reach the currently focused tab when the user clicks the action button.       |
| Host: ATS domains                    | Auto-detect Greenhouse / Lever / Ashby / Workday job forms. Curated list.     |
| **Optional** host: `script.google.com` & `script.googleusercontent.com` | Requested on demand (Options → Grant permission) so the background worker can POST to your Apps Script webhook. Revocable. |
| **Optional** host: `api.openai.com` | Requested on demand (Options → AI → Grant) so the background can stream from OpenAI's chat completions endpoint. Revocable. |
| **Optional** host: `api.anthropic.com` | Same as above for Anthropic's `/v1/messages` streaming endpoint. Revocable. |
| **Optional** host: `generativelanguage.googleapis.com` | Same as above for Google's Gemini OpenAI-compatible endpoint. Revocable. |
| **Optional** host: `http://localhost/*`, `http://127.0.0.1/*` | Requested on demand (Options → AI → Grant) so the background can stream from a local Ollama daemon. Only granted when the user selects Ollama as the provider. Revocable. |

No `tabs`, no `webRequest`, no broad host access beyond the curated ATS list.

## Privacy

- API keys, webhook URLs, and resume bytes live in `chrome.storage.local` —
  never `chrome.storage.sync`.
- No analytics or telemetry. No remote error reporting.
- AI requests (when configured) go directly from your browser to the provider
  you chose using your own API key.
- The "Mark as submitted" webhook is only POSTed to the URL you paste in.

## Roadmap

Each step is shippable on its own.

1. ✅ **Skeleton** — manifest, build, options, profile schema, storage.
2. ✅ Generic adapter + safe filler + popup "Fill this page."
3. ✅ Resume upload into file inputs.
4. ✅ Greenhouse → Lever → Ashby adapters.
5. ✅ AI suggestion button + provider clients (OpenAI + Anthropic).
6. ✅ Sheets webhook + history.
7. ⏳ Workday adapter.
8. ⏳ Encrypted profile export/import.

Step 6 shipped before steps 3-5 because it has no hard dependency on them
and the user wanted Sheets logging early.

## Layout

```
src/
├── background/service-worker.ts     # MV3 worker; routes typed messages
├── content/index.ts                 # injected into ATS pages
├── adapters/                        # (step 2+) per-platform detection
├── profile/
│   ├── schema.ts                    # zod schemas + envelope versions
│   ├── store.ts                     # chrome.storage.local wrapper
│   ├── resume.ts                    # base64 ↔ File helpers
│   └── migrations.ts                # schemaVersion migration hooks
├── lib/
│   ├── messaging.ts                 # typed sendMessage helpers
│   └── logger.ts
├── types/messages.ts                # discriminated union of all messages
└── ui/
    ├── options/                     # profile editor + settings (step 1)
    └── popup/                       # quick status + Fill button (step 1)
```
