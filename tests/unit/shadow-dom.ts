import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function attachShadowTemplates(root: ParentNode): void {
  const templates = Array.from(
    root.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]'),
  );
  for (const template of templates) {
    const host = template.parentElement;
    if (!host || host.shadowRoot) continue;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(template.content.cloneNode(true));
    template.remove();
    attachShadowTemplates(shadow);
  }
}

export function loadShadowFixture(...names: string[]): void {
  document.documentElement.innerHTML = names
    .map((name) => readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8'))
    .join('\n');
  attachShadowTemplates(document);
}

export function shadowInput(host: Element, selector = 'input'): HTMLInputElement {
  const visit = (scope: ParentNode): HTMLInputElement | null => {
    const hit = scope.querySelector<HTMLInputElement>(selector);
    if (hit) return hit;
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (!el.shadowRoot) continue;
      const nested = visit(el.shadowRoot);
      if (nested) return nested;
    }
    return null;
  };
  const found = host.shadowRoot ? visit(host.shadowRoot) : null;
  if (!found) throw new Error(`no ${selector} inside ${host.tagName.toLowerCase()}`);
  return found;
}
