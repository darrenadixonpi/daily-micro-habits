/**
 * Review-card IDs. One card per source item and kind, so recording a task twice never
 * creates a duplicate card; A5 cards are per saved event.
 */
export const cardIdFor = {
  a1: (itemId: string) => `A1:${itemId}`,
  a3: (itemId: string) => `A3:${itemId}`,
  a4: (itemId: string) => `A4:${itemId}`,
  a5: (itemId: string, eventIndex: number) => `A5:${itemId}:${eventIndex}`,
} as const;

export interface ParsedCardId {
  readonly module: 'A1' | 'A3' | 'A4' | 'A5';
  readonly itemId: string;
  readonly eventIndex: number | null;
}

export function parseCardId(cardId: string): ParsedCardId | null {
  const match = /^(A1|A3|A4|A5):([^:]+)(?::(\d+))?$/.exec(cardId);
  if (!match) return null;
  return {
    module: match[1] as ParsedCardId['module'],
    itemId: match[2] ?? '',
    eventIndex: match[3] === undefined ? null : Number(match[3]),
  };
}
