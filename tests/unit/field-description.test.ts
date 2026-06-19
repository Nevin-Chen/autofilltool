import { describe, expect, it, beforeEach } from 'vitest';
import { fieldDescription } from '@/adapters/_shared';

function set(html: string): HTMLTextAreaElement {
  document.body.innerHTML = html;
  const ta = document.querySelector('textarea');
  if (!ta) throw new Error('fixture has no textarea');
  return ta;
}

describe('fieldDescription', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads aria-describedby helper text (the ATS standard hook)', () => {
    const ta = set(`
      <div>
        <label for="q1">Why do you want to work here?</label>
        <p id="q1-help">Name a specific project and keep it under 200 words.</p>
        <textarea id="q1" aria-describedby="q1-help"></textarea>
      </div>
    `);
    expect(fieldDescription(ta)).toBe(
      'Name a specific project and keep it under 200 words.',
    );
  });

  it('falls back to a description-styled sibling in the field wrapper', () => {
    const ta = set(`
      <div class="field">
        <label for="q1">Tell us about yourself</label>
        <div class="field__description">Cover your background, why you're applying, and what you'd bring.</div>
        <textarea id="q1"></textarea>
      </div>
    `);
    expect(fieldDescription(ta)).toMatch(/Cover your background/);
  });

  it('returns empty when the only nearby text is the label itself', () => {
    const ta = set(`
      <div class="field">
        <label for="q1">Cover letter</label>
        <textarea id="q1"></textarea>
      </div>
    `);
    expect(fieldDescription(ta)).toBe('');
  });

  it('does not borrow a sibling field\'s help text from a shared container', () => {
    const ta = set(`
      <form>
        <div class="field">
          <label for="q1">First question</label>
          <textarea id="q1"></textarea>
        </div>
        <div class="field">
          <label for="q2">Second question</label>
          <div class="description">Helper text meant for the second field.</div>
          <input id="q2" type="text" />
        </div>
      </form>
    `);
    expect(fieldDescription(ta)).toBe('');
  });

  it('strips a duplicated label prefix from describedby text', () => {
    const ta = set(`
      <div>
        <label for="q1">Why us?</label>
        <span id="q1-d">Why us? Be concrete about the team you'd join.</span>
        <textarea id="q1" aria-describedby="q1-d"></textarea>
      </div>
    `);
    expect(fieldDescription(ta)).toBe("Be concrete about the team you'd join.");
  });
});
