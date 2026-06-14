import type {
  AiProvider,
  ExemplarAnswer,
  VoiceSample,
} from '@/profile/schema';
import {
  EXEMPLAR_ANSWER_MAX_CHARS,
  VOICE_SAMPLE_MAX_CHARS,
} from '@/profile/schema';
import { budgetForProvider } from '@/ai/voice-budget';
import { Section } from './Section';

type Props = {
  voiceSamples: VoiceSample[];
  exemplars: ExemplarAnswer[];
  onVoiceSamplesChange: (next: VoiceSample[]) => void;
  onExemplarsChange: (next: ExemplarAnswer[]) => void;
  provider: AiProvider;
  model: string;
  defaultCollapsed?: boolean;
};

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  none: 'None',
};

export function WritingSection(props: Props) {
  const budget = budgetForProvider(props.provider, props.model);
  const voiceUsed = props.voiceSamples.reduce((n, s) => n + s.body.length, 0);
  const exemplarUsed = props.exemplars.reduce(
    (n, e) => n + e.questionPattern.length + e.answer.length,
    0,
  );
  const totalUsed = voiceUsed + exemplarUsed;
  const totalCap = budget.voiceCharBudget + budget.exemplarCharBudget;

  const overBudgetVoiceIds = computeOverBudgetVoiceIds(
    props.voiceSamples,
    budget.voiceCharBudget,
  );
  const overBudgetExemplarIds = computeOverBudgetExemplarIds(
    props.exemplars,
    budget.exemplarCharBudget,
  );

  const addVoiceSample = () => {
    const next: VoiceSample = {
      id: crypto.randomUUID(),
      body: '',
      createdAt: new Date().toISOString(),
    };
    props.onVoiceSamplesChange([...props.voiceSamples, next]);
  };
  const updateVoiceBody = (id: string, body: string) =>
    props.onVoiceSamplesChange(
      props.voiceSamples.map((s) => (s.id === id ? { ...s, body } : s)),
    );
  const removeVoiceSample = (id: string) =>
    props.onVoiceSamplesChange(props.voiceSamples.filter((s) => s.id !== id));

  const addExemplar = () => {
    const next: ExemplarAnswer = {
      id: crypto.randomUUID(),
      questionPattern: '',
      answer: '',
      updatedAt: new Date().toISOString(),
      favorite: false,
    };
    props.onExemplarsChange([...props.exemplars, next]);
  };
  const updateExemplarAnswer = (id: string, answer: string) =>
    props.onExemplarsChange(
      props.exemplars.map((e) =>
        e.id === id ? { ...e, answer, updatedAt: new Date().toISOString() } : e,
      ),
    );
  const updateExemplarQuestion = (id: string, questionPattern: string) =>
    props.onExemplarsChange(
      props.exemplars.map((e) =>
        e.id === id
          ? { ...e, questionPattern, updatedAt: new Date().toISOString() }
          : e,
      ),
    );
  const toggleFavorite = (id: string) =>
    props.onExemplarsChange(
      props.exemplars.map((e) =>
        e.id === id ? { ...e, favorite: !(e.favorite ?? false) } : e,
      ),
    );
  const removeExemplar = (id: string) =>
    props.onExemplarsChange(props.exemplars.filter((e) => e.id !== id));

  return (
    <Section
      title="Writing voice"
      hint="Short writing samples teach the AI to match your tone. Used for style only, never as facts. Past application answers act as few-shot examples for similar questions."
      collapsible
      defaultCollapsed={props.defaultCollapsed}
    >
      <div className="space-y-6">
        <BudgetGauge
          providerName={PROVIDER_LABEL[props.provider]}
          totalUsed={totalUsed}
          totalCap={totalCap}
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Voice samples
            </span>
            <button
              type="button"
              onClick={addVoiceSample}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Add voice sample
            </button>
          </div>

          {props.voiceSamples.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No voice samples yet. Paste a paragraph of your own writing
              (school essay, blog post, prior cover letter). The AI uses it
              only to match tone and cadence, never as facts about you.
            </p>
          ) : (
            <ul className="space-y-3">
              {props.voiceSamples.map((s) => {
                const tooLong = s.body.length > VOICE_SAMPLE_MAX_CHARS;
                const over = overBudgetVoiceIds.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <textarea
                      data-testid={`voice-sample-body-${s.id}`}
                      value={s.body}
                      onChange={(e) => updateVoiceBody(s.id, e.target.value)}
                      rows={5}
                      placeholder="Paste a paragraph that sounds like you…"
                      className={`w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:bg-slate-900 dark:text-slate-100 ${
                        tooLong
                          ? 'border-rose-500 dark:border-rose-500'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    />
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            tooLong
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          ({s.body.length} / {VOICE_SAMPLE_MAX_CHARS})
                        </span>
                        {tooLong && (
                          <span className="text-rose-600 dark:text-rose-400">
                            Voice sample must be 1-{VOICE_SAMPLE_MAX_CHARS} characters
                          </span>
                        )}
                        {!tooLong && over && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            (may not ship)
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeVoiceSample(s.id)}
                        className="text-rose-600 hover:underline dark:text-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Past application answers (exemplars)
            </span>
            <button
              type="button"
              onClick={addExemplar}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Add exemplar
            </button>
          </div>

          {props.exemplars.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No exemplars yet. Save your best past answers (e.g. &ldquo;Why
              this company?&rdquo;, &ldquo;Tell us about a challenge.&rdquo;).
              The AI pulls the most relevant exemplar as a few-shot example
              when a similar question appears.
            </p>
          ) : (
            <ul className="space-y-3">
              {props.exemplars.map((e) => {
                const tooLong = e.answer.length > EXEMPLAR_ANSWER_MAX_CHARS;
                const over = overBudgetExemplarIds.has(e.id);
                const fav = e.favorite ?? false;
                return (
                  <li
                    key={e.id}
                    className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <label className="block text-xs">
                      <span className="mb-1 block text-slate-600 dark:text-slate-300">
                        Question or label
                      </span>
                      <input
                        type="text"
                        value={e.questionPattern}
                        onChange={(ev) =>
                          updateExemplarQuestion(e.id, ev.target.value)
                        }
                        placeholder="e.g. Why are you interested in this role?"
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-600 dark:text-slate-300">
                        Answer
                      </span>
                      <textarea
                        data-testid={`exemplar-answer-${e.id}`}
                        value={e.answer}
                        onChange={(ev) =>
                          updateExemplarAnswer(e.id, ev.target.value)
                        }
                        rows={4}
                        className={`w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:bg-slate-900 dark:text-slate-100 ${
                          tooLong
                            ? 'border-rose-500 dark:border-rose-500'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      />
                    </label>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            tooLong
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          ({e.answer.length} / {EXEMPLAR_ANSWER_MAX_CHARS})
                        </span>
                        {tooLong && (
                          <span className="text-rose-600 dark:text-rose-400">
                            Answer must be 1-{EXEMPLAR_ANSWER_MAX_CHARS} characters
                          </span>
                        )}
                        {!tooLong && over && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            (may not ship)
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleFavorite(e.id)}
                          aria-pressed={fav}
                          title={fav ? 'Unfavorite' : 'Mark favorite'}
                          className={
                            fav
                              ? 'text-amber-500 hover:text-amber-600'
                              : 'text-slate-400 hover:text-amber-500'
                          }
                        >
                          {fav ? '★ Favorite' : '☆ Favorite'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeExemplar(e.id)}
                        className="text-rose-600 hover:underline dark:text-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

function BudgetGauge(props: {
  providerName: string;
  totalUsed: number;
  totalCap: number;
}) {
  const fits = props.totalCap > 0 ? props.totalUsed <= props.totalCap : true;
  const status =
    props.totalCap === 0
      ? 'Configure an AI provider to see the budget'
      : fits
        ? '✓ All items fit'
        : '⚠ Some items may not ship';
  return (
    <div
      data-testid="voice-budget-gauge"
      className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/60"
    >
      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-slate-700 dark:border-slate-600 dark:text-slate-200">
        Provider: {props.providerName}
      </span>
      <span className="text-slate-700 dark:text-slate-200">
        {formatChars(props.totalUsed)} / {formatChars(props.totalCap)} chars used
      </span>
      <span
        className={
          fits
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-amber-700 dark:text-amber-300'
        }
      >
        {status}
      </span>
    </div>
  );
}

function formatChars(n: number): string {
  return n.toLocaleString('en-US');
}

function computeOverBudgetVoiceIds(
  samples: VoiceSample[],
  voiceCharBudget: number,
): Set<string> {
  const out = new Set<string>();
  if (voiceCharBudget <= 0) {
    for (const s of samples) out.add(s.id);
    return out;
  }
  const ordered = [...samples].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  let used = 0;
  for (const s of ordered) {
    if (used + s.body.length > voiceCharBudget) {
      out.add(s.id);
      continue;
    }
    used += s.body.length;
  }
  return out;
}

function computeOverBudgetExemplarIds(
  exemplars: ExemplarAnswer[],
  exemplarCharBudget: number,
): Set<string> {
  const out = new Set<string>();
  if (exemplarCharBudget <= 0) {
    for (const e of exemplars) out.add(e.id);
    return out;
  }
  let used = 0;
  for (const e of exemplars) {
    const cost = e.questionPattern.length + e.answer.length;
    if (used + cost > exemplarCharBudget) {
      out.add(e.id);
      continue;
    }
    used += cost;
  }
  return out;
}
