import type { JobFeedback } from './schema';

export type CandidateContext = {
  profileSummary: string;
  resumeText: string;
  disagreements: readonly JobFeedback[];
};

export function candidateBlock(context: CandidateContext): string {
  return [
    'Candidate profile:',
    context.profileSummary.trim() || '(empty)',
    '',
    'Résumé:',
    context.resumeText.trim() || '(no résumé uploaded)',
    '',
    'Past verdicts the candidate disagreed with:',
    ...(context.disagreements.length > 0
      ? context.disagreements.map(disagreementLine)
      : ['(none yet)']),
  ].join('\n');
}

function disagreementLine(feedback: JobFeedback): string {
  const note = feedback.note.trim() ? ` Their note: "${feedback.note.trim()}"` : '';
  return `- You said ${feedback.verdict} for "${feedback.title}" at ${feedback.company || 'an unnamed company'}, and the candidate disagreed.${note}`;
}
