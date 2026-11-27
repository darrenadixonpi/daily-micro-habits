/** The eight pilot modules, their notification window, and the milestone that implements them. */
export type ModuleId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'D1' | 'D2' | 'D3';
export type WindowId = 'morning' | 'evening';

export interface ModuleInfo {
  readonly id: ModuleId;
  readonly name: string;
  readonly window: WindowId;
  readonly implemented: boolean;
  readonly arrivesIn: string;
}

/** Window assignment from spec Section 1. A module counts toward its window only once implemented. */
export const MODULES: readonly ModuleInfo[] = [
  { id: 'A1', name: 'Word of the day', window: 'morning', implemented: true, arrivesIn: 'M3' },
  { id: 'A3', name: 'Concept of the day', window: 'morning', implemented: true, arrivesIn: 'M3' },
  { id: 'A4', name: 'Foreign-language phrase', window: 'morning', implemented: true, arrivesIn: 'M3' },
  { id: 'A5', name: 'On this day', window: 'morning', implemented: true, arrivesIn: 'M3' },
  { id: 'D1', name: 'Morning top-3', window: 'morning', implemented: true, arrivesIn: 'M2' },
  { id: 'A2', name: 'Review', window: 'evening', implemented: true, arrivesIn: 'M3' },
  { id: 'D2', name: 'Evening review', window: 'evening', implemented: true, arrivesIn: 'M2' },
  { id: 'D3', name: 'Journal', window: 'evening', implemented: true, arrivesIn: 'M2' },
];

export function activeModules(enabled: readonly string[], window: WindowId): ModuleInfo[] {
  return MODULES.filter((module) => module.window === window && module.implemented && enabled.includes(module.id));
}
