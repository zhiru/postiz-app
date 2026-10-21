/** Reasoning effort encoded in a model ID is authoritative over a separate option. */
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function modelReasoningPreset(
  model?: string | null
): ReasoningEffort | undefined {
  const match = model
    ?.trim()
    .toLowerCase()
    .match(/(?:[-:/])(none|minimal|low|medium|high|xhigh|max|ultra)$/);
  return match?.[1] as ReasoningEffort | undefined;
}
