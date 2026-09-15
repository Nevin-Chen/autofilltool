import { describe, expect, it } from 'vitest';
import { fillField, fillVirtualizedDropdown } from '@/content/filler';

describe('veteran questions asked outside an EEO block', () => {
  const OPTIONS = ['Yes, I am a veteran', 'No, I am not a veteran'];

  function mountCombobox(options: string[]): {
    trigger: HTMLInputElement;
    committed: () => string | null;
  } {
    document.body.innerHTML = '';
    const trigger = document.createElement('input');
    trigger.type = 'text';
    trigger.setAttribute('role', 'combobox');
    document.body.appendChild(trigger);

    let menu: HTMLElement | null = null;
    let committed: string | null = null;

    const render = () => {
      if (!menu) return;
      const query = trigger.value.trim().toLowerCase();
      menu.innerHTML = options
        .filter((o) => o.toLowerCase().includes(query))
        .map((o) => `<div role="option">${o}</div>`)
        .join('');
    };
    const open = () => {
      if (menu) return;
      menu = document.createElement('div');
      menu.setAttribute('role', 'listbox');
      document.body.appendChild(menu);
      render();
    };

    trigger.addEventListener('mousedown', open);
    trigger.addEventListener('click', open);
    trigger.addEventListener('input', render);
    trigger.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === 'ArrowDown') {
        open();
        return;
      }
      if (key !== 'Enter') return;
      const first = menu?.querySelector('[role="option"]');
      if (!first) return;
      committed = first.textContent!.trim();
      menu?.remove();
      menu = null;
      trigger.value = '';
    });

    return { trigger, committed: () => committed };
  }

  it('does not answer "yes, I am a veteran" for a profile that says the opposite', async () => {
    const { trigger, committed } = mountCombobox(OPTIONS);

    const action = await fillVirtualizedDropdown(
      {
        el: trigger,
        kind: 'veteranStatus',
        label: 'Are you a veteran?',
        confidence: 0.7,
        widget: 'virtualizedDropdown',
      },
      'I am not a protected veteran',
      { forceOverwrite: false, suppressFlash: true, timeoutMs: 50 },
    );

    expect(action.status).toBe('filled');
    expect(committed()).toBe('No, I am not a veteran');
  });

  it('picks the negated radio for a negated profile answer', () => {
    document.body.innerHTML = `
      <form>
        <label><input type="radio" name="vet" value="yes" />Yes, I am a veteran</label>
        <label><input type="radio" name="vet" value="no" />No, I am not a veteran</label>
      </form>`;
    const yes = document.querySelector<HTMLInputElement>('input[value="yes"]')!;
    const action = fillField(
      { el: yes, kind: 'veteranStatus', label: 'Are you a veteran?', confidence: 0.7 },
      'I am not a protected veteran',
      { forceOverwrite: false, suppressFlash: true },
    );
    expect(action.status).toBe('filled');
    expect(yes.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[value="no"]')!.checked).toBe(
      true,
    );
  });
});
