import type { AiProvider, AiSettings, Profile } from '@/profile/schema';
import { budgetForProvider, type VoiceBudget } from './voice-budget';
import {
  scoreExemplar,
  EXEMPLAR_SIM_THRESHOLD,
} from './voice-similarity';

export type VoiceContextSample = { body: string };

export type VoiceContextExemplar = {
  questionPattern: string;
  answer: string;
  score: number;
  favorite: boolean;
};

export type VoiceBudgetReport = {
  provider: AiProvider;
  voiceCharsUsed: number;
  voiceCharBudget: number;
  exemplarCharsUsed: number;
  exemplarCharBudget: number;
  samplesShipped: number;
  samplesSkipped: number;
  exemplarsShipped: number;
  exemplarsConsidered: number;
};

export type VoiceContext = {
  voiceSamples: VoiceContextSample[];
  exemplars: VoiceContextExemplar[];
  budgetReport: VoiceBudgetReport;
};

export function collectVoiceContext(
  profile: Profile,
  question: string,
  settings: AiSettings,
): VoiceContext {
  const budget = budgetForProvider(settings.provider, settings.model);
  const voicePick = pickVoiceSamples(profile.voiceSamples, budget);
  const exemplarPick = pickExemplars(profile.savedAnswers, question, budget);

  return {
    voiceSamples: voicePick.shipped,
    exemplars: exemplarPick.shipped,
    budgetReport: {
      provider: settings.provider,
      voiceCharsUsed: voicePick.charsUsed,
      voiceCharBudget: budget.voiceCharBudget,
      exemplarCharsUsed: exemplarPick.charsUsed,
      exemplarCharBudget: budget.exemplarCharBudget,
      samplesShipped: voicePick.shipped.length,
      samplesSkipped: voicePick.skipped,
      exemplarsShipped: exemplarPick.shipped.length,
      exemplarsConsidered: exemplarPick.considered,
    },
  };
}

function pickVoiceSamples(
  samples: Profile['voiceSamples'],
  budget: VoiceBudget,
): { shipped: VoiceContextSample[]; skipped: number; charsUsed: number } {
  if (budget.voiceCharBudget <= 0 || samples.length === 0) {
    return { shipped: [], skipped: samples.length, charsUsed: 0 };
  }
  const ordered = [...samples].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shipped: VoiceContextSample[] = [];
  let used = 0;
  let skipped = 0;
  for (const s of ordered) {
    if (s.body.length === 0) continue;
    if (used + s.body.length > budget.voiceCharBudget) {
      skipped += 1;
      continue;
    }
    shipped.push({ body: s.body });
    used += s.body.length;
  }
  return { shipped, skipped, charsUsed: used };
}

function pickExemplars(
  exemplars: Profile['savedAnswers'],
  question: string,
  budget: VoiceBudget,
): {
  shipped: VoiceContextExemplar[];
  considered: number;
  charsUsed: number;
} {
  if (budget.maxExemplars <= 0 || budget.exemplarCharBudget <= 0) {
    return { shipped: [], considered: exemplars.length, charsUsed: 0 };
  }

  const scored = exemplars
    .map((e) => {
      const fav = e.favorite ?? false;
      return {
        e,
        fav,
        score: scoreExemplar(question, e.questionPattern, fav),
      };
    })
    .filter((row) => row.score >= EXEMPLAR_SIM_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const shipped: VoiceContextExemplar[] = [];
  let used = 0;
  for (const row of scored) {
    if (shipped.length >= budget.maxExemplars) break;
    const cost = row.e.questionPattern.length + row.e.answer.length;
    if (used + cost > budget.exemplarCharBudget) continue;
    shipped.push({
      questionPattern: row.e.questionPattern,
      answer: row.e.answer,
      score: row.score,
      favorite: row.fav,
    });
    used += cost;
  }
  return { shipped, considered: exemplars.length, charsUsed: used };
}
