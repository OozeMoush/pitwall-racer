import type { Compound } from './TireModel';

export function twoCompoundWarning(
  usedCompounds: Set<Compound>,
  currentCompound: Compound,
  selectedCompound: Compound,
  lap: number,
  totalLaps: number,
  pitRequested: boolean,
): string | undefined {
  if (usedCompounds.size >= 2) return undefined;
  if (lap < totalLaps - 2) return undefined;

  if (selectedCompound === currentCompound) return 'SELECT A DIFFERENT TYRE · 4/5/6';
  if (pitRequested) return `SECOND COMPOUND COMMITTED → ${selectedCompound}`;
  if (lap >= totalLaps) return `BOX NOW · SECOND COMPOUND → ${selectedCompound}`;
  return `SECOND COMPOUND REQUIRED · NEXT ${selectedCompound}`;
}
