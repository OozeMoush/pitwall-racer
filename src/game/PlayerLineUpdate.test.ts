import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { QualifyingGame } from './QualifyingGame';
import { PlayerRacingLineCandidateRecorder, loadPlayerRacingLineCandidate, saveBestPlayerRacingLineCandidate } from '../simulation/PlayerRacingLineCandidate';
import { saveSelectedRacingLineSource } from '../simulation/RacingLineSelectionStore';
import { activateStoredRacingLine } from '../simulation/RacingLineActivation';
import { activeReferenceTarget, runtimeRacingLine, setRuntimeRacingLine } from '../simulation/RacingLineRuntime';
import { setActiveTrack } from '../simulation/TrackModel';

class Storage {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('quota');
    this.values.set(key, value);
  }
}
function recorder(offset: number) {
  const result = new PlayerRacingLineCandidateRecorder();
  result.begin('pitwall-gp', 1);
  for (let i = 0; i < 480; i++) result.sample(i / 480, offset, 60, 0, 0, 1 / 120, 1, 0);
  return result;
}
function race(lineCandidate: PlayerRacingLineCandidateRecorder) {
  return Object.assign(Object.create(CoreRaceGame.prototype), {
    setup: { trackId: 'pitwall-gp' }, lineCandidate,
    lapValidity: { snapshot: () => ({ candidateEligible: true, warnings: 0 }) },
    lap: 2, lapPitted: false, debugEnabled: false,
  }) as any;
}
function solo(lineCandidate: PlayerRacingLineCandidateRecorder) {
  return Object.assign(Object.create(QualifyingGame.prototype), {
    setup: { trackId: 'pitwall-gp' }, mode: 'TIME_TRIAL', lineCandidate,
    lapTime: 29, lapValidity: { snapshot: () => ({ candidateEligible: true }), reset() {} },
    completedLaps: 0, sectorTimes: [9, 10], sessionTimeTrialLaps: [],
    timeTrialRecord: {}, announceSectorSplit() {},
    paceEvidence: { begin() {} }, tire: { compound: 'SOFT', wear: 0, grip: 1 },
  }) as any;
}
describe('player line session update boundaries', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = new Storage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    setActiveTrack('pitwall-gp');
    saveSelectedRacingLineSource(storage, 'pitwall-gp', 'PLAYER');
    saveBestPlayerRacingLineCandidate(storage, recorder(0).finish(30)!);
    activateStoredRacingLine(storage, 'pitwall-gp');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setRuntimeRacingLine('pitwall-gp'); });

  it('saves a faster race lap and changes the actual CPU target immediately', () => {
    const before = activeReferenceTarget('pitwall-gp', 0.5, 1);
    const game = race(recorder(2));
    game.commitRaceLineCandidate(29, true);
    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(29);
    expect(runtimeRacingLine('pitwall-gp')?.lapSeconds).toBe(29);
    expect(activeReferenceTarget('pitwall-gp', 0.5, 1).laneOffset).not.toBeCloseTo(before.laneOffset);
    expect(game.racingLineNotice).toContain('CPU LINE UPDATED');
  });
  it('keeps the previous runtime line and reports a failed storage write', () => {
    storage.fail = true;
    const game = race(recorder(2));
    game.commitRaceLineCandidate(29, true);
    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(30);
    expect(runtimeRacingLine('pitwall-gp')?.lapSeconds).toBe(30);
    expect(game.racingLineNotice).toContain('STORAGE FAILED');
  });
  it('keeps a slower race lap and never announces an update', () => {
    const game = race(recorder(2));
    game.commitRaceLineCandidate(31, true);
    expect(runtimeRacingLine('pitwall-gp')?.lapSeconds).toBe(30);
    expect(game.lineCandidateStatus).toContain('KEPT');
  });
  it('rejects an invalid lap without changing stored or runtime targets', () => {
    const game = race(recorder(2));
    game.commitRaceLineCandidate(29, false);
    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(30);
    expect(runtimeRacingLine('pitwall-gp')?.lapSeconds).toBe(30);
    expect(game.racingLineNotice).toContain('INVALID LAP');
  });
  it('explains why a faster lower-quality trace cannot replace the CPU line', () => {
    const candidate = recorder(2).finish(29)!;
    candidate.points = candidate.points.map(({ progress, laneOffset, targetSpeed }) => ({ progress, laneOffset, targetSpeed }));
    const game = race(recorder(2));
    game.lineCandidate = { finish: () => candidate };
    game.commitRaceLineCandidate(29, true);
    expect(game.lineCandidateStatus).toContain('REJECT · TRACE');
    expect(runtimeRacingLine('pitwall-gp')?.lapSeconds).toBe(30);
  });
  it('saves without overriding AUTO selection', () => {
    saveSelectedRacingLineSource(storage, 'pitwall-gp', 'AUTO');
    activateStoredRacingLine(storage, 'pitwall-gp');
    const game = race(recorder(2));
    game.commitRaceLineCandidate(29, true);
    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(29);
    expect(runtimeRacingLine('pitwall-gp')).toBeUndefined();
    expect(game.racingLineNotice).toContain('PLAYER LINE SAVED');
  });
  it('announces a saved Time Trial lap and activates it on the next session entry', () => {
    const game = solo(recorder(2));
    game.completeLap();
    expect(game.lapNotice).toContain('PLAYER LINE UPDATED');
    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(29);
    // main.ts calls this at menu/session entry and after qualifying.
    activateStoredRacingLine(storage, 'pitwall-gp');
    expect(runtimeRacingLine('pitwall-gp')?.lapSeconds).toBe(29);
    expect(activeReferenceTarget('pitwall-gp', 0.5, 1).laneOffset).toBeCloseTo(2, 1);
  });
  it('saves a qualifying lap and uses it when the same weekend starts the race', () => {
    const game = solo(recorder(2));
    game.mode = 'QUALIFYING';
    game.physics = { stopPlayer() {}, playerState: () => ({}) };
    game.paceEvidence.finish = () => ({ trackId: 'pitwall-gp', seconds: 29, compound: 'SOFT',
      startWear: 0, endWear: 0, deepCutRatio: 0, grassRatio: 0, maxTow: 0,
      launchAffected: false, recovered: false, pitted: false });
    game.completeLap();
    expect(game.result.playerTime).toBe(29);
    activateStoredRacingLine(storage, 'pitwall-gp');
    expect(runtimeRacingLine('pitwall-gp')?.lapSeconds).toBe(29);
    expect(activeReferenceTarget('pitwall-gp', 0.5, 1).laneOffset).toBeCloseTo(2, 1);
  });
  it('reports a Time Trial storage failure instead of a successful line update', () => {
    storage.fail = true;
    const game = solo(recorder(2));
    game.completeLap();
    expect(game.lapNotice).toContain('STORAGE FAILED');
    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(30);
  });
});
