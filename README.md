# AutoFillTool

A somewhat lazy tool to make the most out of local models and AI subscriptions for customized outputs on job applications.

## Links

- [Claude Code bridge setup](bridge/README.md)

## Features

#### **Auto-fill**
- Works on Greenhouse, Lever, Ashby, Workday, JazzHR, Workable, Breezy HR, SmartRecruiters, and Gem. Anything else falls back to matching keywords in the field labels
- Fields that already have a value are skipped, including a search field where you already picked a result. Turn on **Force overwrite** to fill over them
- Radios, checkboxes, and Yes/No toggles that already hold the right answer are never clicked again. Some forms clear the answer on a second click
- Fills ATS iframes embedded in a company's careers page, not just the ATS domain itself
- Filled fields flash so you can see what changed
- While the AI works on a field, the page scrolls to it. Turn on **Disable auto-scroll to field** in the popup to stay put

#### **Phone and Location**
- Phone fields with their own country dropdown get the country picked and only the national number typed, so the dial code isn't doubled
- US and Canadian numbers go in as `212-555-0142`, without the `+1`. Other countries keep their dial code
- Location fields with a "Locate me" button use the button, and fall back to your saved city if the browser won't share a location
- Location fields that search as you type get your city typed in and the top suggestion picked, so `Austin, TX` lands on the `Austin, Texas, United States` the form wants. The search gets up to 4 seconds to answer

#### **Workday**
- Covers all four steps of the apply wizard: My Information, My Experience, Application Questions, and Voluntary Disclosures. The Fill pill comes back on each step after **Save and Continue**
- Works on both `myworkdayjobs.com` and `myworkdaysite.com`
- Workday's own fields are filled by name. "How did you hear about us?" gets LinkedIn, Phone Device Type gets Mobile, and an acknowledgement that asks for today's date gets today's date
- Questions the employer wrote are only answered from your profile when they ask about work authorization, sponsorship, relocation, or self-identification. Everything else goes to the AI with the question as written

#### **SmartRecruiters**
- Every input sits inside a web component's shadow root. The filler reaches into them, picks from the custom dropdowns, and presses Enter on the month/year pickers, which ignore a typed date until you do
- One-click apply is two steps. Fill handles the profile page. After **Next**, the Fill pill comes back on the Preliminary questions page for the self-identification answers
- On that second page, "How did you hear about this job?" gets the online job listing option (not a fair, an event, or a referral), and the required certify, terms, and privacy-notice boxes are ticked. Read them before you submit, ticking one agrees on your behalf

#### **Résumé Attachment**
- PDF, DOCX, or TXT, up to 5 MB. Stored locally and attached to the file input as if you picked it yourself
- Keep up to 5 labelled résumés (backend, ML, new grad) and mark one as the default
- Pick a different one for a company in the popup and it sticks. The next posting from that company uses the same résumé

#### **Work and Education History**
- Save each job and each school as its own entry in Options, in the order forms ask for them
- Workday, Workable, Breezy HR, and JazzHR make you type your history block by block. Each block gets the matching entry, so the second job goes in the second block. On Workday, Fill clicks Add until there's a block for every saved entry
- Blocks are found from the page structure, not a per-site selector list, so a form I haven't seen before still gets its entries lined up
- SmartRecruiters turns your résumé into its own Experience and Education entries, often with the company folded into the title. Fill deletes those and adds your saved entries in your order. It leaves a section alone when the entries already match, or when one is open for editing
- Some of these sites parse your résumé and prefill the blocks, usually with the company in the job title or the wrong dates. **Replace values in work and education blocks** in Options lets the filler correct those blocks and only those. Every other field on the page keeps whatever value it already had

#### **AI**
- Adds an **Autofill** button to textarea fields that drafts an answer from the job description on the page, the text in your résumé, and the role
- Five providers: OpenAI, Anthropic, Gemini, Ollama, or your Claude Code subscription through the local bridge
- **Use AI for skipped fields** lets the model answer what your profile couldn't. It sees your saved jobs, your schools, and the role you're applying for, so "have you worked here before" or "do you meet the experience requirement" is answered from your history
- By default it only touches fields the form marks required (`required`, `aria-required`, or a `*` or `✱` on the label). Optional fields show up as skipped in the review pane. Turn off **Only answer required fields** in the popup to let it fill everything

#### **Job Feed**
- Save the URL of a search you already filtered on a job board, plus a short note on what makes a job a fit. **Check now** in the popup opens each search in a background tab, reads the listings, and closes the tab
- Only postings from today that haven't been judged yet go to Claude, through the local bridge. A quick screen drops clear non-fits (not a software role, a stack you have none of, a dealbreaker from your note) and sends everything plausible on
- Each job that passes the screen gets its full posting read in a background tab and reviewed on its own by Opus against your whole résumé, profile, and note. The review lists every requirement as met, partial, or missing, with the résumé line that backs it up, plus flags like onsite outside your city or a clearance
- Every résumé line Claude quotes is checked against your actual résumé text. A strong verdict that leans on a quote that isn't there drops to maybe, and the quote is marked on the card
- **Agree** or **Disagree** on any verdict. Disagreements, with your note on what Claude got wrong, go into every later check
- The same posting on another job board (identical title, company, city, and requirements summary) is dropped. When only the title and company match, Claude compares the two descriptions: a reworded copy goes under Repeats, a different role gets judged
- Results show on the Jobs page with a **Why** list for each match, the job page and direct apply links, and how often you've agreed with Claude. The count of strong and maybe matches shows on the extension icon. Results are kept for 7 days
- Each job board needs its own reader, added one board at a time. LinkedIn and Indeed are next

#### **Voluntary Self-Identification**
- Save gender, pronouns, Hispanic/Latino, race, sexual orientation, transgender identity, veteran status, and disability status once, in Options
- Forms word these their own way ("Male" in your profile against Man / Woman / Non-binary on the form), so the saved answer is matched to whichever option the form offers instead of being typed in as-is
- "I am not a protected veteran" picks a plain "I am not a veteran" when a form offers both that and "a veteran, but not a protected veteran"
- Nothing here is guessed. Leave an answer blank and the field is left for you, unless you opt in to letting the AI pick the decline option
- A question that mentions disability or religion only as an exception ("other than for reasons related to a disability, can you work onsite four days a week?") isn't treated as a self-identification question

#### **Work Authorization**
- Sponsorship and work authorization questions are answered from your saved answer in Options, not by the model
- The wording is read first. "Do you require sponsorship" gets No where "can you work without sponsorship" gets Yes
- A question about how you got your work authorization ("is it based on being the spouse of an H-1B holder?") isn't answered from the authorized-to-work toggle. The AI gets it along with your saved answers

#### **Submission Tracking**
- Every application goes to local history, which you can browse from the popup and export to CSV
- Optional push to a Google Sheet you own, through Apps Script
- Optional auto-log that watches for your submission to go through and logs it for you

#### **Safety**
- The filler won't click anything labelled Submit, Apply now, or Send application
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
- The background picks which frames get filled. If a subframe is an ATS host, only those frames are filled, so the newsletter signup on the company's page is left alone
- Each frame picks an adapter, classifies its fields, then writes through the native value setter so React's value tracker fires

**AI flow:**
- The content script opens a long-lived `ai-suggest` port to the background worker
- The background worker is the only code that talks to an outside host. It builds the prompt, sends it to your provider, and streams the tokens back
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

   Open a job application and click **Fill this page** on the pill, or in the extension popup. Check what it filled, use **Autofill** on any open-ended answers, then submit it yourself.

For a distributable zip: `npm run package`.

After every `npm run build`, reload the extension in `chrome://extensions`. A tab still running the old build can't load the new content script until you do.

### Watch mode

```bash
npm run dev
```

Vite 5 only allows local HTTP origins through its dev-server CORS, which blocks the service worker from fetching `@vite/env`. `vite.config.ts` allows `chrome-extension://*` so HMR works. Start `npm run dev` **before** reloading the extension. If that gives you trouble, `npm run build` makes a static `dist/` that doesn't need the dev server.

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

Drafts through your Claude Code subscription instead of a paid API key, in a writing voice you define. It doesn't use Ollama.

```bash
npm run bridge         # start on http://localhost:11435
npm run bridge:stop    # stop it from anywhere
```

Then pick **Claude Code (local bridge)** in Options. The endpoint and model fill in on their own. Full setup, including the writing-voice spec, is in [bridge/README.md](bridge/README.md).

### What gets sent to the provider

**Autofill on a textarea** (the button, or AI fill on a long-form field):
- The question, plus the help text under it when there is one (up to 800 characters)
- The role and company, if the adapter could read them
- The job description from the page (up to 3,000 characters)
- Your résumé text (up to 6,000 characters)

**Job feed** (always the Claude Code bridge):
- Every request: a profile summary (the same one AI fill uses), your default résumé text (up to 6,000 characters), your "what makes a job a fit" note, and up to 10 of your recent disagreements with their notes
- Screen (`sonnet`, 20 listings per request): each new listing's title, company, city, workplace type, pay, years asked, the board's requirements summary, and its tools
- Review (`opus`, one listing per request, 3 at a time): the same fields plus the full posting text (up to 12,000 characters)

**AI fill on short fields:**
- The question and its options
- The role and company
- A profile summary: name, email, phone, address, links, work authorization answers, desired salary, notice period, your saved jobs and schools, and your saved self-identification answers

Each request only goes to the provider URL you granted permission for.

## Google Sheets Logging (optional)

Sends each tracked submission to a Google Sheet through an Apps Script web app **you own**. Nothing is sent unless you set it up.

1. Create a Sheet and add an Apps Script `doPost` web app, deployed as "Anyone with the link"
2. Paste the `/exec` URL into **Options → Tracking** and click **Test**

## Testing

```bash
npm test           # vitest run
npm run test:e2e   # playwright
npx tsc --noEmit   # type check only
npm run lint       # eslint
```

### Environment Variables

The extension itself doesn't need any. Everything you configure lives in the Options page and is stored in `chrome.storage.local`.

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
| `storage` | Keep your profile, settings, résumés, and history locally |
| `scripting` | Inject the filler into pages when you click Fill |
| `activeTab` | Reach the focused tab from the popup |
| `webNavigation` | Notice an ATS iframe loading inside another page, and route changes inside single-page apply flows |
| Host: ATS domains | Auto-detect Greenhouse, Lever, Ashby, Workday, JazzHR, Workable, Breezy HR, SmartRecruiters, and Gem forms |
| Host: `<all_urls>` | Show the Fill pill on a company's careers page when the application is an ATS iframe embedded in it, and read a saved job search in a background tab |

**Optional**, asked for when you need them and revocable from Options:

| Host | Why |
|------|-----|
| `script.google.com`, `script.googleusercontent.com` | Apps Script webhook for Sheets logging |
| `api.openai.com` | OpenAI streaming endpoint |
| `api.anthropic.com` | Anthropic `/v1/messages` streaming endpoint |
| `generativelanguage.googleapis.com` | Google Gemini |
| `http://localhost/*`, `http://127.0.0.1/*` | Ollama (11434) or the Claude Code bridge (11435) |

No `tabs` and no `webRequest`. The background only injects into a page outside the ATS list when an ATS iframe loads inside it.

## Privacy

- API keys, webhook URLs, and résumé bytes live in `chrome.storage.local`, never `chrome.storage.sync`
- No analytics, no telemetry, no remote error reporting
- AI requests go straight from your browser to the provider you picked
- Job feed results, meaning the listings and Claude's verdicts, stay in `chrome.storage.local` for 7 days and then drop off
- The webhook only POSTs to the URL you paste in

## Project Layout

```
src/
├── background/   MV3 service worker (the only code that talks to external hosts)
├── content/      Injected scripts: filler, AI suggest, submit-watch, overlay
├── adapters/     Per-ATS detection (Greenhouse / Lever / Ashby / Workday / JazzHR / Workable / Breezy HR / SmartRecruiters / Gem + generic)
├── ai/           Provider dispatch, SSE parser, résumé text extraction
├── jobs/         Job feed: board sources, repeat detection, Claude judge prompt, storage
├── profile/      Zod schemas, chrome.storage.local wrapper, migrations
├── tracking/     Sheets webhook client
├── lib/          Messaging, events, permissions, logger, history export
├── types/        Shared message envelope
└── ui/           React + Tailwind options page, popup, and Jobs page
bridge/           Local Claude Code subscription bridge (not part of the extension build)
```

## Roadmap

- LinkedIn and Indeed sources for the job feed
- Per-site allowlist for persistent injection without a click
- Cache the job description across Workday's multi-page wizard
- Single-source-of-truth versioning across `package.json`, `manifest.json`, and `package-lock.json`

## Notes

Three rules I stuck to:

- **Local-first.** No backend ships with the extension. The only network calls are the page you're on, the job searches you saved, the AI provider you picked, and your own Apps Script webhook
- **User-in-the-loop.** The filler never clicks Submit. `SUBMIT_DENY` in `src/content/filler.ts` enforces it
- **Safe autofill.** Fields with a value are skipped by default. Values go through the native value setter so React registers the change, followed by `input`, `change`, and a blur

## Author

[Nevin Chen](https://linkedin.com/in/nevin-chen) | [Portfolio](https://nevinchen.dev)
