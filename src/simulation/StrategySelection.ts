import type { Compound } from './TireModel';

export interface StartingTyreSelection {
  startCompound: Compound;
  suggestedNextCompound: Compound;
}

export function selectStartingTyre(startCompound: Compound): StartingTyreSelection {
  const suggestedNextCompound: Compound = startCompound === 'MEDIUM' ? 'SOFT' : 'MEDIUM';
  return { startCompound, suggestedNextCompound };
}
