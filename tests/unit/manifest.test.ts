import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../manifest.json'), 'utf8'),
) as {
  permissions: string[];
  host_permissions: string[];
  content_scripts: Array<{
    matches: string[];
    js: string[];
    run_at: string;
    all_frames: boolean;
  }>;
};

describe('manifest content_scripts — invariants', () => {
  it('declares exactly two content_scripts entries (ATS + parent-stub marker)', () => {
    expect(manifest.content_scripts).toHaveLength(2);
  });

  it('first entry (ATS) auto-injects into ALL frames', () => {
    // Required so the content script runs inside ATS iframes embedded on
    // company career pages (e.g. spotandtango.com → job-boards.greenhouse.io
    // inside `#grnhse_app`). Without this the iframe-side pill never mounts.
    expect(manifest.content_scripts[0]!.all_frames).toBe(true);
    expect(manifest.content_scripts[0]!.js).toContain('src/content/index.ts');
  });

  it('runs at document_idle (not document_start/end)', () => {
    expect(manifest.content_scripts[0]!.run_at).toBe('document_idle');
  });

  it('matches the four ATS hosts and their canonical subdomains', () => {
    const matches = manifest.content_scripts[0]!.matches;
    expect(matches).toContain('https://*.greenhouse.io/*');
    expect(matches).toContain('https://job-boards.greenhouse.io/*');
    expect(matches).toContain('https://*.lever.co/*');
    expect(matches).toContain('https://*.ashbyhq.com/*');
    expect(matches).toContain('https://*.myworkdayjobs.com/*');
  });

  it('second entry exists for parent-stub bundling (never-match)', () => {
    // The parent-stub is injected dynamically by the background via
    // chrome.scripting.executeScript when an ATS iframe is detected. It
    // is registered as a content_scripts entry purely so crxjs bundles
    // the file and we can read its hashed path from the live manifest.
    const stub = manifest.content_scripts[1]!;
    expect(stub.js).toContain('src/content/parent-stub.ts');
    expect(stub.all_frames).toBe(false);
    // Match URL is intentionally a `.invalid` host so Chrome never
    // auto-injects it; the marker substring lets the SW find this entry.
    expect(stub.matches.join(' ')).toContain('aft-parent-stub-bundle-marker');
  });
});

describe('manifest permissions — invariants', () => {
  it('declares webNavigation (required to detect ATS sub-frame commits)', () => {
    expect(manifest.permissions).toContain('webNavigation');
  });

  it('declares <all_urls> in host_permissions (parent-stub injection)', () => {
    // Required so chrome.scripting.executeScript can inject the parent-stub
    // into arbitrary company career pages. Tradeoff: Chrome shows
    // "read all sites" at install. The stub itself only acts when it
    // receives a strict-shape postMessage from an ATS-host origin.
    expect(manifest.host_permissions).toContain('<all_urls>');
  });

  it('keeps storage + scripting + activeTab', () => {
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('scripting');
    expect(manifest.permissions).toContain('activeTab');
  });
});
