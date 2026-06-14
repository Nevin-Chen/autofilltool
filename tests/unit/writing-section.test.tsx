import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  AiProvider,
  ExemplarAnswer,
  VoiceSample,
} from '@/profile/schema';
import { WritingSection } from '@/ui/options/WritingSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(
  initial: {
    voiceSamples?: VoiceSample[];
    exemplars?: ExemplarAnswer[];
    provider?: AiProvider;
    model?: string;
  } = {},
) {
  let voiceSamples = initial.voiceSamples ?? [];
  let exemplars = initial.exemplars ?? [];
  const provider: AiProvider = initial.provider ?? 'openai';
  const model = initial.model ?? 'gpt-4o-mini';

  const Wrapper = () => (
    <WritingSection
      voiceSamples={voiceSamples}
      exemplars={exemplars}
      onVoiceSamplesChange={(next) => {
        voiceSamples = next;
        actualRender();
      }}
      onExemplarsChange={(next) => {
        exemplars = next;
        actualRender();
      }}
      provider={provider}
      model={model}
    />
  );

  const actualRender = () => act(() => root.render(<Wrapper />));
  actualRender();

  return {
    get voiceSamples() {
      return voiceSamples;
    },
    get exemplars() {
      return exemplars;
    },
    rerenderWithProvider(nextProvider: AiProvider, nextModel: string) {
      act(() =>
        root.render(
          <WritingSection
            voiceSamples={voiceSamples}
            exemplars={exemplars}
            onVoiceSamplesChange={() => {}}
            onExemplarsChange={() => {}}
            provider={nextProvider}
            model={nextModel}
          />,
        ),
      );
    },
  };
}

function expandSection() {
  const toggle = container.querySelector('button[aria-expanded]');
  if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
    act(() => (toggle as HTMLButtonElement).click());
  }
}

function findButtonByText(text: string): HTMLButtonElement {
  for (const btn of Array.from(container.querySelectorAll('button'))) {
    if (btn.textContent?.trim() === text) return btn as HTMLButtonElement;
  }
  throw new Error(`button "${text}" not found`);
}

describe('WritingSection — voice samples (US1)', () => {
  it('renders an Add voice sample button and shows the empty state', () => {
    render();
    expandSection();
    expect(findButtonByText('Add voice sample')).toBeTruthy();
    expect(container.textContent).toMatch(/No voice samples yet/);
  });

  it('adds a new empty voice sample on click; live counter renders (0 / 3000)', () => {
    const ctrl = render();
    expandSection();
    act(() => findButtonByText('Add voice sample').click());
    expect(ctrl.voiceSamples).toHaveLength(1);
    expect(container.textContent).toMatch(/\(0 \/ 3000\)/);
  });

  it('typing into a voice textarea updates the controlled state and counter', () => {
    const seed: VoiceSample = {
      id: '11111111-1111-4111-8111-111111111111',
      body: '',
      createdAt: new Date().toISOString(),
    };
    const ctrl = render({ voiceSamples: [seed] });
    expandSection();
    const ta = container.querySelector(
      `textarea[data-testid="voice-sample-body-${seed.id}"]`,
    ) as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    setNativeTextarea(ta, 'hello voice');
    expect(ctrl.voiceSamples[0]!.body).toBe('hello voice');
    expect(container.textContent).toMatch(/\(11 \/ 3000\)/);
  });

  it('flags an over-cap voice sample with the red error message', () => {
    const seed: VoiceSample = {
      id: '11111111-1111-4111-8111-111111111111',
      body: 'x'.repeat(3001),
      createdAt: new Date().toISOString(),
    };
    render({ voiceSamples: [seed] });
    expandSection();
    expect(container.textContent).toMatch(/Voice sample must be 1-3000 characters/);
  });
});

describe('WritingSection — exemplars (US2)', () => {
  it('renders an Add exemplar button and shows the empty state', () => {
    render();
    expandSection();
    expect(findButtonByText('Add exemplar')).toBeTruthy();
    expect(container.textContent).toMatch(/No exemplars yet/);
  });

  it('adds an empty exemplar row with question + answer + favorite + counter', () => {
    const ctrl = render();
    expandSection();
    act(() => findButtonByText('Add exemplar').click());
    expect(ctrl.exemplars).toHaveLength(1);
    expect(container.textContent).toMatch(/Question or label/);
    expect(container.textContent).toMatch(/\(0 \/ 3000\)/);
    expect(container.textContent).toMatch(/Favorite/);
  });

  it('toggling favorite flips the flag without touching updatedAt', () => {
    const seed: ExemplarAnswer = {
      id: '22222222-2222-4222-8222-222222222222',
      questionPattern: 'Why?',
      answer: 'Because.',
      updatedAt: '2026-01-01T00:00:00.000Z',
      favorite: false,
    };
    const ctrl = render({ exemplars: [seed] });
    expandSection();
    const favBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Favorite'),
    ) as HTMLButtonElement;
    expect(favBtn).toBeTruthy();
    act(() => favBtn.click());
    expect(ctrl.exemplars[0]!.favorite).toBe(true);
    expect(ctrl.exemplars[0]!.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('flags over-cap exemplar answer with the red error message', () => {
    const seed: ExemplarAnswer = {
      id: '22222222-2222-4222-8222-222222222222',
      questionPattern: 'Why?',
      answer: 'x'.repeat(3001),
      updatedAt: new Date().toISOString(),
    };
    render({ exemplars: [seed] });
    expandSection();
    expect(container.textContent).toMatch(/Answer must be 1-3000 characters/);
  });
});

describe('WritingSection — budget gauge (US3)', () => {
  it('renders gauge with provider pill and char counts', () => {
    render({ provider: 'openai', model: 'gpt-4o-mini' });
    expandSection();
    const gauge = container.querySelector(
      '[data-testid="voice-budget-gauge"]',
    ) as HTMLElement;
    expect(gauge).toBeTruthy();
    expect(gauge.textContent).toMatch(/Provider: OpenAI/);
    expect(gauge.textContent).toMatch(/0 \/ 10,000 chars used/);
    expect(gauge.textContent).toMatch(/All items fit/);
  });

  it('flips to "may not ship" when content exceeds the provider cap', () => {
    const big: VoiceSample = {
      id: '33333333-3333-4333-8333-333333333333',
      body: 'a'.repeat(2000),
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    render({
      voiceSamples: [big],
      provider: 'ollama',
      model: 'llama3.2',
    });
    expandSection();
    const gauge = container.querySelector(
      '[data-testid="voice-budget-gauge"]',
    ) as HTMLElement;
    expect(gauge.textContent).toMatch(/Provider: Ollama/);
    expect(gauge.textContent).toMatch(/2,000 \/ 2,400 chars used/);
    expect(container.textContent).toMatch(/may not ship/);
  });

  it('recomputes when provider switches from cloud to Ollama default', () => {
    const ctrl = render({ provider: 'openai', model: 'gpt-4o-mini' });
    expandSection();
    let gauge = container.querySelector(
      '[data-testid="voice-budget-gauge"]',
    ) as HTMLElement;
    expect(gauge.textContent).toMatch(/0 \/ 10,000 chars used/);
    ctrl.rerenderWithProvider('ollama', 'llama3.2');
    expandSection();
    gauge = container.querySelector(
      '[data-testid="voice-budget-gauge"]',
    ) as HTMLElement;
    expect(gauge.textContent).toMatch(/Provider: Ollama/);
    expect(gauge.textContent).toMatch(/0 \/ 2,400 chars used/);
  });
});

function setNativeTextarea(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(el, value);
  act(() => el.dispatchEvent(new Event('input', { bubbles: true })));
}
