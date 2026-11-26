import { daysBetween } from '../time/logical_day';

/** Optional D3 prompts (off by default); one is shown per day, rotating in order. */
export const JOURNAL_PROMPTS: readonly { readonly id: string; readonly text: string }[] = [
  'What took more energy today than you expected?',
  'What is one thing you learned today, and where did it come from?',
  'Which decision today would you make the same way again?',
  'What did you postpone, and what would make it easier tomorrow?',
  'Who helped you today, directly or indirectly?',
  'What surprised you today?',
  'Where did you spend attention you would like back?',
  'What went well that you did not plan for?',
  'What question is still on your mind tonight?',
  'What would you tell yourself at the start of today?',
  'Which task today had the best ratio of effort to result?',
  'What did you notice about your mood across the day?',
  'What is one idea from today worth revisiting in a month?',
  'What did you avoid today, and why?',
  'What made today different from yesterday?',
  'Which conversation today mattered most?',
  'What would make tomorrow morning easier?',
  'What did you finish today, however small?',
  'What are you currently overestimating or underestimating?',
  'What did you read, watch or hear today that stuck with you?',
  'Where did you feel most focused today?',
  'What is a small improvement you could test tomorrow?',
  'What drained you today, and what restored you?',
  'Which of today’s priorities mattered least in hindsight?',
  'What did you do today purely because you wanted to?',
  'What assumption did today challenge?',
  'What are you grateful for from today, specifically?',
  'What will you want to remember about this week?',
  'What problem became clearer today?',
  'If today had a title, what would it be?',
].map((text, index) => ({ id: `p${String(index + 1).padStart(2, '0')}`, text }));

export function promptForDate(date: string): { readonly id: string; readonly text: string } {
  const index = ((daysBetween('2026-01-01', date) % JOURNAL_PROMPTS.length) + JOURNAL_PROMPTS.length) % JOURNAL_PROMPTS.length;
  return JOURNAL_PROMPTS[index] as { readonly id: string; readonly text: string };
}
