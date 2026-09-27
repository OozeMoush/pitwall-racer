import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CAR_CONTACT_MIN_RELATIVE_SPEED,
  RapierRacePhysics,
  carRelativeImpactSpeed,
} from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { TRACK_BARRIER_OFFSET } from './TrackLimitsModel';
import { sampleTrack, setActiveTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical player/car impact classification', () => {
  beforeAll(async () => {
    await RAPIER.init();
    setActiveTrack('pitwall-gp');
  });

  it('ignores a contact pair when two cars are moving together at nearly the same velocity', () => {
    const physics = overlappingPair(60, 60);
    try {
      physics.step(DT);
      expect(physics.playerContactKind()).toBe('NONE');
      expect(physics.playerImpactSpeed()).toBe(0);
      expect(physics.aiContactKind(0)).toBe('NONE');
      expect(physics.aiImpactSpeed(0)).toBe(0);
    } finally {
      physics.world.free();
    }
  });

  it('classifies a real closing-speed collision and reports relative impact speed', () => {
    const physics = overlappingPair(60, 40);
    try {
      physics.step(DT);
      expect(physics.playerContactKind()).toBe('CAR');
      expect(physics.playerImpactSpeed()).toBeGreaterThan(
        CAR_CONTACT_MIN_RELATIVE_SPEED,
      );
      expect(physics.playerImpactSpeed()).toBeCloseTo(20, 1);
      expect(physics.aiContactKind(0)).toBe('CAR');
      expect(physics.aiImpactSpeed(0)).toBeCloseTo(20, 1);
    } finally {
      physics.world.free();
    }
  });

  it('reports a real CPU wall hit with the wall-normal impact speed', () => {
    const progress = 0.50;
    const side = 1;
    const driver = createAiField()[0];
    driver.progress = progress;
    driver.laneOffset = 0;
    const playerPose = sampleTrack(0.15);
    const physics = new RapierRacePhysics(
      createVehicle(playerPose.x, playerPose.y, playerPose.heading),
      [driver],
    );

    try {
      const startLane = side * (TRACK_BARRIER_OFFSET - CAR_COLLIDER_HALF_LENGTH - 2);
      const pose = sampleTrack(progress, startLane);
      const outwardHeading = pose.heading + Math.PI / 2;
      physics.setAiState(0, {
        ...createVehicle(pose.x, pose.y, outwardHeading),
        speed: 70,
      });

      let sawBarrierImpact = false;
      let maximumImpactSpeed = 0;
      for (let tick = 0; tick < 1.2 / DT; tick++) {
        physics.step(DT);
        if (physics.aiContactKind(0) === 'BARRIER') {
          sawBarrierImpact = true;
          maximumImpactSpeed = Math.max(maximumImpactSpeed, physics.aiImpactSpeed(0));
        }
      }

      expect(sawBarrierImpact).toBe(true);
      expect(maximumImpactSpeed).toBeGreaterThan(1);
    } finally {
      physics.world.free();
    }
  });

  it('measures impact energy from relative velocity rather than absolute player speed', () => {
    expect(carRelativeImpactSpeed(80, 0, 79, 0)).toBeCloseTo(1, 6);
    expect(carRelativeImpactSpeed(80, 0, 55, 0)).toBeCloseTo(25, 6);
  });
});

function overlappingPair(
  playerSpeed: number,
  aiSpeed: number,
): RapierRacePhysics {
  const progress = 0.42;
  const pose = sampleTrack(progress);
  const driver = createAiField()[0];
  driver.progress = progress;
  driver.laneOffset = 0;
  driver.lap = 0;

  // The cars overlap slightly so Rapier definitely reports a contact pair.
  // Only relative velocity should decide whether that pair becomes a crash.
  const playerStart = {
    ...createVehicle(
      pose.x - Math.cos(pose.heading) * 8.8,
      pose.y - Math.sin(pose.heading) * 8.8,
      pose.heading,
    ),
    speed: playerSpeed,
  };
  const physics = new RapierRacePhysics(playerStart, [driver]);
  // RapierRacePhysics construction places bodies but does not seed dynamic
  // velocity from VehicleState. Set both bodies explicitly so this test really
  // exercises 60-vs-60 and 60-vs-40 relative impact speeds.
  physics.setPlayerState(playerStart);
  physics.setAiState(0, {
    ...createVehicle(pose.x, pose.y, pose.heading),
    speed: aiSpeed,
  });
  return physics;
}
