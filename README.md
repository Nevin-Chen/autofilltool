# AutoFillTool

A local-first Chrome extension (Manifest V3) that autofills common job-application
fields, attaches your résumé, and helps you draft answers to open-ended questions
using your own AI key. **You** always click Submit.

Supports **Greenhouse**, **Lever**, **Ashby**, and **Workday** out of the box,
with a generic fallback for any other form.

## Features

- **Auto-fill** — popup → Fill this page. Per-ATS selectors with a
  heuristic generic fallback for the long tail.
- **Résumé attachment** — PDF / DOCX / TXT (≤ 5 MB), stored locally and
  attached to the file input as if you'd selected it yourself.
- **AI Suggest** — ✨ button next to every open-ended textarea streams a
  draft using OpenAI, Anthropic, Gemini, or local **Ollama**. Drafts are
  grounded in the job description, your résumé text, and your profile — the
  system prompt forbids inventing facts.
- **Writing voice** — paste short prose samples or favorite past answers in
  Options → Writing voice; Suggest mirrors your tone and structure without
  treating those samples as new facts. Provider-aware budget gauge shows
  how much of your saved writing fits each call.
- **Submission tracking** — record each apply to local history, navigate it
  from the popup, export to CSV, or push to a Google Sheet you control.
- **Skip-if-filled** by default; **Force overwrite** toggle for re-runs.
- **Safety guard** — the filler refuses to click anything labelled Submit /
  Apply now / Send application.

## Install

Requires Node 20+.

```bash
npm install
npm run build
```

Load it in Chrome:

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/`.
2. Pin the extension and open the popup.
3. Right-click the icon → **Options** to set up your profile and résumé.

For distribution: `npm run package` zips `dist/` to `autofilltool.zip`.

## Usage

1. Open **Options** → fill in your profile and upload a résumé.
2. Visit any job-application page on a supported ATS.
3. Click the extension icon → **Fill this page**.
4. A small pill in the bottom-right shows counts; review what was filled.
5. For open-ended questions, click the ✨ to stream a draft (if AI is configured).
6. Click Submit yourself. The extension never does.

The popup's **Recent submissions** section lets you navigate logged submissions
(◄ / ► / jump-to-index), export the full history to CSV, or clear it.

## Google Sheets logging (optional)

Forwards each tracked submission to a Google Sheet via an Apps Script web app
**you own**. Nothing is sent unless you configure this.

### 1. Create the Apps Script

Open the sheet you want to log to. Then:

**Extensions → Apps Script** → paste the code below → **Save** → **Deploy → New
deployment**. Pick **Web app**, set "Execute as: Me" and "Who has access:
Anyone", deploy, and copy the **Web app URL**.

```js
// AutoFillTool — appends one row per submission to the active sheet.
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

  // Test pings (Options → Send test ping) just confirm reachability.
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

1. **Options → Tracking (optional)** → paste the Web app URL.
2. Click **Grant permission** — Chrome will prompt to allow requests to
   `script.google.com` and `script.googleusercontent.com`. Revocable.
3. Click **Send test ping**. You should see `Test ping succeeded`.

Submissions always land in local history; the webhook POST is best-effort
(one retry on network error, then it surfaces the failure in the pill).

## AI suggestions (optional)

1. **Options → AI suggestions** → pick a provider:

| Provider | Default model | Where to get a key |
| --- | --- | --- |
| OpenAI (pay-as-you-go) | `gpt-4o-mini` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic (pay-as-you-go) | `claude-3-5-haiku-20241022` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| Google Gemini (free tier) | `gemini-2.5-flash` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| **Ollama** (fully local, no key) | `llama3.2` | install [ollama.com](https://ollama.com) → `ollama pull llama3.2` |

2. Paste your key (skip for Ollama). Keys are stored only in
   `chrome.storage.local`, never `chrome.storage.sync`.
3. Click **Grant permission** so the background worker can reach the provider
   host. One prompt per provider.
4. Click **Test** for a one-shot round-trip.

After Fill, every open-ended textarea gets a ✨ button. Click → streams a draft
straight into the field. Click again while streaming to cancel.

### What gets sent to the provider

- The question + label from the page.
- Company / role / job URL if the adapter could read them.
- A short profile summary (name, links, saved answers, cover-letter blurb).
- Extracted résumé text (PDF via pdfjs-dist, DOCX via mammoth, TXT inline).
- A scraped job description (per-ATS adapter selectors; Mozilla Readability fallback).

Nothing leaves the background worker except the request to the provider URL
you authorised.

## Permissions

**Required**

| Permission | Why |
| --- | --- |
| `storage` | Persist profile, settings, résumé, and history locally. |
| `scripting` | Inject the filler into pages when you click Fill. |
| `activeTab` | Reach the currently focused tab from the popup. |
| Host: ATS domains | Auto-detect Greenhouse / Lever / Ashby / Workday forms. Curated list. |

**Optional** — requested on demand and revocable from Options:

| Host | Why |
| --- | --- |
| `script.google.com`, `script.googleusercontent.com` | Apps Script webhook for Sheets logging. |
| `api.openai.com` | OpenAI chat-completions streaming endpoint. |
| `api.anthropic.com` | Anthropic `/v1/messages` streaming endpoint. |
| `generativelanguage.googleapis.com` | Google Gemini (OpenAI-compatible). |
| `http://localhost/*`, `http://127.0.0.1/*` | Local Ollama daemon. |

No `tabs`, no `webRequest`, no broad host access beyond the ATS list.

## Privacy

- API keys, webhook URLs, and résumé bytes live in `chrome.storage.local` —
  never `chrome.storage.sync`.
- No analytics or telemetry. No remote error reporting.
- AI requests go **directly** from your browser to the provider you chose,
  using your own API key.
- The "Mark submitted" / auto-log webhook is POSTed only to the URL you paste in.

## Develop

```bash
npm install
npm run dev      # Vite watch mode; writes to dist/
npm run build    # tsc --noEmit && vite build
npm test         # vitest run
npm run lint     # eslint
```

> **Dev-mode CORS note**: Vite 5 restricts its dev server CORS allowlist to
> local HTTP origins, which blocks the extension's service worker from
> fetching `@vite/env`. `vite.config.ts` allows `chrome-extension://*` so HMR
> works out of the box. If you see `Service worker registration failed`, make
> sure `npm run dev` is running **before** you reload the extension on
> `chrome://extensions`. For a friction-free setup, `npm run build` produces
> a fully static `dist/` you can load and reload without a dev server.

## Layout

```
src/
├── background/   MV3 service worker (the only code that talks to external hosts)
├── content/      Injected scripts: filler, AI suggest, submit-watch, overlay
├── adapters/     Per-ATS detection (Greenhouse / Lever / Ashby / Workday + generic)
├── ai/           Provider dispatch, SSE parser, résumé text extraction
├── profile/      Zod schemas, chrome.storage.local wrapper, migrations
├── tracking/     Sheets webhook client
├── lib/          Messaging, events, permissions, logger, history export
├── types/        Shared message envelope
└── ui/           React + Tailwind options page and popup
```
