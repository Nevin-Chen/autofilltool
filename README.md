# AutoFillTool

A Manifest V3 Chrome extension that autofills common job-application fields
and keeps you in control of the final Submit click. **Local-first**: nothing
leaves your machine unless you explicitly configure an AI provider or a
tracking webhook.

This repo is built in shippable increments. See `Roadmap` below for what
exists today and what's coming.

## Status

**v0.5.0 — Steps 1 + 2 + 3 + 4 + 6 of 8: skeleton + generic fill + resume upload + ATS adapters (Greenhouse / Lever / Ashby) + Google Sheets logging.**

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
  `urls[LinkedIn|GitHub|Portfolio]`), and Ashby
  (`[data-testid="FieldEntry"]` walks with structured `FieldLabel`
  classification). Each overrides `fillResume` with the platform's exact
  slot before falling back to the shared finder.
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
- 72 vitest unit tests covering schema, migrations, filler, generic adapter,
  per-platform adapters (matches + detectFields + fillResume against
  realistic fixture HTML for each ATS), webhook client, job-context, and
  the resume base64/File round-trip + file-input attachment + slot
  detection.

What is intentionally **not** here yet:

- Workday adapter (step 7) — needs iframe + virtualised-list handling.
- AI suggestions and the provider clients (step 5).
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

## Permissions

| Permission                           | Why                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `storage`                            | Persist profile, settings, resume, and history in `chrome.storage.local`.      |
| `scripting`                          | Inject the filler into pages on user request.                                  |
| `activeTab`                          | Reach the currently focused tab when the user clicks the action button.       |
| Host: ATS domains                    | Auto-detect Greenhouse / Lever / Ashby / Workday job forms. Curated list.     |
| **Optional** host: `script.google.com` & `script.googleusercontent.com` | Requested on demand (Options → Grant permission) so the background worker can POST to your Apps Script webhook. Revocable. |

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
5. ⏳ AI suggestion button + one provider.
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
