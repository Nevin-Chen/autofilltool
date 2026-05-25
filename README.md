# AutoFillTool

A Manifest V3 Chrome extension that autofills common job-application fields
and keeps you in control of the final Submit click. **Local-first**: nothing
leaves your machine unless you explicitly configure an AI provider or a
tracking webhook.

This repo is built in shippable increments. See `Roadmap` below for what
exists today and what's coming.

## Status

**v0.1.0 — Step 1 of 8: skeleton.**

What works:

- Manifest V3 with minimum permissions (`storage`, `scripting`, `activeTab`).
- TypeScript + Vite + `@crxjs/vite-plugin` build.
- Profile / Settings / Resume / History schemas (zod) with a `schemaVersion`
  migration hook.
- `chrome.storage.local` wrapper with safe-parsing reads and a bounded
  history ring.
- Typed message envelope between popup, content scripts, and the service
  worker (round-trip is smoke-tested by a `PING` from the popup).
- React + Tailwind options page with a working profile editor.
- React + Tailwind popup with a placeholder "Fill this page" button.

What is intentionally **not** here yet:

- The filler primitives and any platform adapters (step 2-3).
- Resume upload into file inputs (step 3).
- AI suggestions and the provider clients (step 5).
- Sheets webhook + per-submission history (step 6).
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

## Permissions

| Permission           | Why                                                                          |
| -------------------- | ---------------------------------------------------------------------------- |
| `storage`            | Persist profile, settings, resume, and history in `chrome.storage.local`.    |
| `scripting`          | Inject the filler into pages on user request (used in step 2+).              |
| `activeTab`          | Reach the currently focused tab when the user clicks the action button.     |
| Host: ATS domains    | Auto-detect Greenhouse / Lever / Ashby / Workday job forms. Curated list.   |

No `tabs`, no `webRequest`, no broad host access beyond the curated ATS list.

## Privacy

- API keys, webhook URLs, and resume bytes live in `chrome.storage.local` —
  never `chrome.storage.sync`.
- No analytics or telemetry. No remote error reporting.
- AI requests (when configured) go directly from your browser to the provider
  you chose using your own API key.
- The "Mark as submitted" webhook is only POSTed to the URL you paste in.

## Roadmap

The roadmap is in `Project Instructions`. Build order:

1. **Skeleton** — manifest, build, options, profile schema, storage. ← _shipping now_
2. Generic adapter + safe filler + popup "Fill this page."
3. Resume upload into file inputs.
4. Greenhouse → Lever → Ashby adapters.
5. AI suggestion button + one provider.
6. Sheets webhook + history.
7. Workday adapter.
8. Encrypted profile export/import.

Each step is shippable on its own.

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
