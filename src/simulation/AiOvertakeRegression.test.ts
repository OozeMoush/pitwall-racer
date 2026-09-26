import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, raceDistance } from './RaceModel';
import { createTire } from './TireModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical AI overtaking regression', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('lets a quicker car pass naturally through FOLLOW and SIDE_BY_SIDE', () => {
    const [trailer, leader] = createAiField();
    const leaderProgress = 0.18;
    const trailerProgress = leaderProgress - 18 / TRACK_LENGTH;

    leader.lap = 1;
    leader.progress = leaderProgress;
    leader.laneOffset = 0;
    leader.preferredLane = 0;
    leader.skill = 1.105;
    leader.tire = createTire('MEDIUM');

    trailer.lap = 1;
    trailer.progress = trailerProgress;
    trailer.laneOffset = 0;
    trailer.preferredLane = 0;
    trailer.skill = 1.155;
    trailer.tire = createTire('MEDIUM');

    const remote = sampleTrack(0.60, 200);
    const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [trailer, leader]);

    const trailerStart = sampleTrack(trailer.progress, 0);
    const leaderStart = sampleTrack(leader.progress, 0);
    physics.setAiState(0, { ...createVehicle(trailerStart.x, trailerStart.y, trailerStart.heading), speed: 84 });
    physics.setAiState(1, { ...createVehicle(leaderStart.x, leaderStart.y, leaderStart.heading), speed: 76 });

    let maxLateralSeparation = 0;
    let maxTrailerLeadMetres = Number.NEGATIVE_INFINITY;
    let sawSideBySide = false;
    const timeline: Array<Record<string, number | string>> = [];

    for (let tick = 0; tick < 12 / DT; tick++) {
      physics.syncAiKinematics([trailer, leader], DT, -10);
      if (trailer.battleState === 'SIDE_BY_SIDE' || leader.battleState === 'SIDE_BY_SIDE') sawSideBySide = true;
      physics.step(DT);

      const states = physics.aiStates();
      const trailerProjection = projectTrackNear(states[0].x, states[0].y, trailer.progress);
      const leaderProjection = projectTrackNear(states[1].x, states[1].y, leader.progress);
      const signedGap = (raceDistance(trailer.lap, trailer.progress) - raceDistance(leader.lap, leader.progress)) * TRACK_LENGTH;
      maxLateralSeparation = Math.max(
        maxLateralSeparation,
        Math.abs(trailerProjection.laneOffset - leaderProjection.laneOffset),
      );
      maxTrailerLeadMetres = Math.max(maxTrailerLeadMetres, signedGap);

      if ((tick + 1) % 120 === 0) {
        timeline.push({
          second: (tick + 1) / 120,
          gap: Number(signedGap.toFixed(1)),
          trailerKmh: Math.round(states[0].speed * 3.6),
          leaderKmh: Math.round(states[1].speed * 3.6),
          trailerLane: Number(trailerProjection.laneOffset.toFixed(1)),
          leaderLane: Number(leaderProjection.laneOffset.toFixed(1)),
          trailerState: trailer.battleState,
          leaderState: leader.battleState,
        });
      }
    }

    console.log(`OVERTAKE_METRICS ${JSON.stringify({
      sawSideBySide,
      maxLateralSeparation: Number(maxLateralSeparation.toFixed(2)),
      maxTrailerLeadMetres: Number(maxTrailerLeadMetres.toFixed(2)),
      timeline,
    })}`);

    expect(sawSideBySide).toBe(true);
    expect(maxLateralSeparation).toBeGreaterThan(5.5);
    expect(maxTrailerLeadMetres).toBeGreaterThan(2.0);
  }, 20_000);
});
