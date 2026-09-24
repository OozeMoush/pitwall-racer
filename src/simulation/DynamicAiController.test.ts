import { afterEach, describe, expect, it } from 'vitest';
import {
  aiExplicitPaceForSkill,
  aiGripMultiplier,
  aiPaceCheatForSkill,
  aiPowerBoostForSkill,
  aiSkillGripMultiplier,
  dynamicAiControl,
} from './DynamicAiController';
import { createAiField, type RaceTrafficCar } from './RaceModel';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import { AI_SAFE_LANE_LIMIT, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
});

describe('dynamicAiControl', () => {
  it('uses the tow first, then moves off line smoothly to attack without crossing the road', () => {
    const driver = createAiField()[0];
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 78 };
    const ahead: RaceTrafficCar = {
      id: 'leader',
      lap: driver.lap,
      progress: driver.progress + 26 / TRACK_LENGTH,
      speed: 68,
      laneOffset: 0,
      performance: 1,
    };

    const follow = dynamicAiControl(driver, vehicle, [ahead]);
    expect(follow.battleState).toBe('FOLLOW');

    const closeAhead = {
      ...ahead,
      progress: driver.progress + 12 / TRACK_LENGTH,
    };
    const attack = dynamicAiControl(driver, vehicle, [closeAhead]);
    expect(attack.battleState).toBe('ATTACK');
    expect(Math.abs(attack.targetLane - closeAhead.laneOffset)).toBeGreaterThanOrEqual(2.2);
    // A 3.2 m first move is deliberate enough to clear the wake without the
    // old full-lane jump; the separate stable-side regression prevents it from
    // oscillating back across the rival on the next controller tick.
    expect(Math.abs(attack.targetLane)).toBeLessThanOrEqual(3.3);
    expect(Math.abs(attack.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('commits to the same passing side instead of weaving across the rival', () => {
    const driver = createAiField()[0];
    const ahead: RaceTrafficCar = {
      id: 'leader',
      lap: driver.lap,
      progress: driver.progress + 10 / TRACK_LENGTH,
      speed: 68,
      laneOffset: 0,
      performance: 1,
    };
    const left = sampleTrack(driver.progress, -1.2);
    const right = sampleTrack(driver.progress, 1.2);
    const leftControl = dynamicAiControl(driver, { ...createVehicle(left.x, left.y, left.heading), speed: 78 }, [ahead]);
    const rightControl = dynamicAiControl(driver, { ...createVehicle(right.x, right.y, right.heading), speed: 78 }, [ahead]);

    expect(leftControl.battleState).toBe('ATTACK');
    expect(rightControl.battleState).toBe('ATTACK');
    expect(Math.sign(leftControl.targetLane)).toBe(Math.sign(rightControl.targetLane));
  });

  it('holds a real side-by-side lane against another AI instead of reforming a train', () => {
    const driver = createAiField()[1];
    const p = sampleTrack(driver.progress, 5.5);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 76 };
    const other: RaceTrafficCar = {
      id: 'ai-rival',
      lap: driver.lap,
      progress: driver.progress + 4 / TRACK_LENGTH,
      speed: 75,
      laneOffset: -1.0,
      performance: driver.skill * driver.tire.grip,
    };

    const control = dynamicAiControl(driver, vehicle, [other]);
    expect(control.battleState).toBe('SIDE_BY_SIDE');
    expect(Math.abs(control.targetLane - other.laneOffset)).toBeGreaterThanOrEqual(6.0);
    expect(Math.abs(control.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('leaves usable lateral room when the player is alongside', () => {
    const driver = createAiField()[1];
    const p = sampleTrack(driver.progress, 5);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 72 };
    const other: RaceTrafficCar = {
      id: 'player',
      lap: driver.lap,
      progress: driver.progress + 5 / TRACK_LENGTH,
      speed: 72,
      laneOffset: -5,
      performance: 1,
      isPlayer: true,
    };

    const control = dynamicAiControl(driver, vehicle, [other]);
    expect(control.battleState).toBe('SIDE_BY_SIDE');
    expect(Math.abs(control.targetLane - other.laneOffset)).toBeGreaterThanOrEqual(6.0);
    expect(Math.abs(control.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('locks directly onto an explicit player lane instead of soft-clamping the target', () => {
    const driver = createAiField()[0];
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 64 };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: driver.tire.grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 8,
        targetSpeed: 64,
      })),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.battleState).toBe('CLEAR');
    expect(control.targetLane).toBeGreaterThan(6.5);
  });

  it('keeps explicit player pace within the fixed CPU difficulty boost', () => {
    const driver = createAiField()[0];
    driver.progress = 0.56;
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 64 };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: driver.tire.grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 64,
      })),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.lineSource).toBe('PLAYER');
    expect(control.targetSpeed).toBeGreaterThan(64 * 1.01);
    expect(control.targetSpeed).toBeLessThan(72);
  });

  it('corrects overspeed more aggressively when PLAYER dynamics are demonstrated', () => {
    const driver = createAiField()[0];
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 64 };
    const basePoints = Array.from({ length: 160 }, (_, index) => ({
      progress: index / 160,
      laneOffset: 0,
      targetSpeed: 60,
    }));

    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: driver.tire.grip,
      points: basePoints,
    });
    const legacy = dynamicAiControl(driver, vehicle, []);

    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: driver.tire.grip,
      points: basePoints.map((point) => ({
        ...point,
        headingOffset: 0,
        yawRate: 0,
      })),
    });
    const enriched = dynamicAiControl(driver, vehicle, []);

    expect(enriched.debug.demonstratedDynamics).toBe(true);
    expect(enriched.brake).toBeGreaterThan(legacy.brake);
  });

  it('keeps positive AXF authoritative through a small speed-phase error', () => {
    const driver = createAiField()[0];
    driver.skill = 1.14;
    driver.progress = 0.20;
    const grip = driver.tire.grip;
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 73.5 };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 72,
        headingOffset: 0,
        yawRate: 0,
        tireGrip: grip,
        longitudinalAcceleration: 3.25,
        forwardAcceleration: 7.5,
      })),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.sourceForwardAcceleration).toBeCloseTo(7.5, 5);
    expect(control.debug.sourceNetSpeedAcceleration).toBeCloseTo(3.25, 5);
    expect(control.debug.feedbackBrake).toBe(0);
    expect(control.brake).toBe(0);
    expect(control.throttle).toBeGreaterThan(0);
  });

  it('keeps the demonstrated AXF brake phase when materially underspeed', () => {
    const driver = createAiField()[0];
    driver.skill = 1.14;
    driver.progress = 0.20;
    const grip = driver.tire.grip;
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 66 };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 72,
        headingOffset: 0,
        yawRate: 0,
        tireGrip: grip,
        longitudinalAcceleration: -5,
        forwardAcceleration: -7.5,
      })),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.sourceForwardAcceleration).toBeCloseTo(-7.5, 5);
    expect(control.debug.profileBrake).toBeGreaterThan(0.01);
    expect(control.brake).toBeGreaterThan(0.01);
    expect(control.throttle).toBe(0);
  });

  it('does not panic-brake a Q5 trace for a modest path miss', () => {
    const driver = createAiField()[0];
    driver.skill = 1.14;
    driver.progress = 0.20;
    const grip = driver.tire.grip;
    const lineLane = 0;
    const vehicleLane = 3.5;
    const vehiclePose = sampleTrack(driver.progress, vehicleLane);
    const vehicle = {
      ...createVehicle(vehiclePose.x, vehiclePose.y, vehiclePose.heading),
      speed: 72,
    };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        const pose = sampleTrack(progress, lineLane);
        return {
          progress,
          laneOffset: lineLane,
          targetSpeed: 72,
          worldX: pose.x,
          worldY: pose.y,
          bodyHeading: pose.heading,
          headingOffset: 0,
          yawRate: 0,
          tireGrip: grip,
          longitudinalAcceleration: 3,
          forwardAcceleration: 7.5,
        };
      }),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.pathError).toBeGreaterThan(3);
    expect(control.debug.pathError).toBeLessThan(5);
    expect(control.targetSpeed).toBeGreaterThan(71);
    expect(control.debug.feedbackBrake).toBe(0);
    expect(control.brake).toBe(0);
  });

  it('still slows a Q5 trace after a genuine large path departure', () => {
    const driver = createAiField()[0];
    driver.skill = 1.14;
    driver.progress = 0.20;
    const grip = driver.tire.grip;
    const lineLane = 0;
    const vehicleLane = 11;
    const vehiclePose = sampleTrack(driver.progress, vehicleLane);
    const vehicle = {
      ...createVehicle(vehiclePose.x, vehiclePose.y, vehiclePose.heading),
      speed: 72,
    };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        const pose = sampleTrack(progress, lineLane);
        return {
          progress,
          laneOffset: lineLane,
          targetSpeed: 72,
          worldX: pose.x,
          worldY: pose.y,
          bodyHeading: pose.heading,
          headingOffset: 0,
          yawRate: 0,
          tireGrip: grip,
          longitudinalAcceleration: 0,
          forwardAcceleration: 0,
        };
      }),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.pathError).toBeGreaterThan(8);
    expect(control.targetSpeed).toBeLessThan(68);
  });

  it('uses explicit-path phase for Q5 absolute-pose speed control', () => {
    const driver = createAiField()[0];
    driver.skill = 1.14;
    driver.progress = 0.25;
    const grip = driver.tire.grip;
    const offsetProgress = 0.27;
    const pathPose = sampleTrack(offsetProgress, 9);
    const vehicle = { ...createVehicle(pathPose.x, pathPose.y, pathPose.heading), speed: 60 };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        const pose = sampleTrack(progress, 9);
        return {
          progress,
          laneOffset: 9,
          targetSpeed: progress >= 0.26 && progress < 0.30 ? 50 : 80,
          worldX: pose.x,
          worldY: pose.y,
          bodyHeading: pose.heading,
          headingOffset: 0,
          yawRate: 0,
          tireGrip: grip,
          longitudinalAcceleration: 0,
          forwardAcceleration: 0,
        };
      }),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.progress).toBeGreaterThan(0.255);
    expect(control.targetSpeed).toBeLessThan(60);
  });

  it('brakes before a future player-line speed drop reaches the car', () => {
    const driver = createAiField()[0];
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 82 };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: driver.tire.grip,
      points: Array.from({ length: 160 }, (_, index) => {
        const progress = index / 160;
        const distanceAhead = ((progress - driver.progress + 1) % 1) * TRACK_LENGTH;
        return {
          progress,
          laneOffset: 0,
          targetSpeed: distanceAhead >= 84 && distanceAhead <= 144 ? 34 : 82,
        };
      }),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.brake).toBeGreaterThan(0.15);
    expect(control.throttle).toBe(0);
  });

  it('aims straight back at the circuit after an excursion', () => {
    const driver = createAiField()[2];
    const laneOffset = TRACK_RUNOFF_HALF_WIDTH + 5;
    const p = sampleTrack(driver.progress, laneOffset);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 82 };

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.targetLane).toBe(0);
    expect(control.targetSpeed).toBeLessThanOrEqual(40);
    expect(control.brake).toBeGreaterThan(0);
  });

  it('does not yank a PLAYER line off the kerb just because the car centre crosses the white line', () => {
    const driver = createAiField()[1];
    driver.progress = 0.18;
    const sourceGrip = 1.22;
    driver.tire = { ...driver.tire, grip: 1.02 };
    const lineLane = 18.4;
    const pose = sampleTrack(driver.progress, lineLane);
    const vehicle = {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: 60,
    };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: sourceGrip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        const point = sampleTrack(progress, lineLane);
        return {
          progress,
          laneOffset: lineLane,
          targetSpeed: 72,
          worldX: point.x,
          worldY: point.y,
          bodyHeading: point.heading,
          headingOffset: 0,
          yawRate: 0,
          tireGrip: sourceGrip,
        };
      }),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.demonstratedDynamics).toBe(true);
    expect(control.targetSpeed).toBeGreaterThan(58);
    expect(Math.abs(control.debug.pathError)).toBeLessThan(1.5);
  });


  it('gives the field a stable skill-shaped pace advantage without rubber-banding', () => {
    expect(aiPaceCheatForSkill(1.118)).toBeCloseTo(1.055, 5);
    expect(aiPaceCheatForSkill(1.127)).toBeCloseTo(1.070, 5);
    expect(aiPaceCheatForSkill(1.136)).toBeCloseTo(1.085, 5);
  });


  it('runs every race CPU above the demonstrated PLAYER pace and gives the top car more hardware', () => {
    expect(aiExplicitPaceForSkill(1.118)).toBeCloseTo(1.000, 5);
    expect(aiExplicitPaceForSkill(1.136)).toBeCloseTo(1.000, 5);
    expect(aiSkillGripMultiplier(1.118)).toBeCloseTo(1.0, 6);
    expect(aiSkillGripMultiplier(1.136)).toBeCloseTo(1.010, 6);
    expect(aiPowerBoostForSkill(1.118)).toBeCloseTo(0.065, 6);
    expect(aiPowerBoostForSkill(1.136)).toBeCloseTo(0.115, 6);
  });


  it('gives Soft the largest CPU grip assist for faithful player-line tracking', () => {
    expect(aiGripMultiplier('SOFT')).toBeCloseTo(1.075, 6);
    expect(aiGripMultiplier('MEDIUM')).toBeCloseTo(1.055, 6);
    expect(aiGripMultiplier('HARD')).toBeCloseTo(1.045, 6);
  });


  it('releases a demonstrated brake phase when a race CPU has been knocked to a halt', () => {
    const driver = createAiField()[4];
    driver.progress = 0.72;
    const grip = driver.tire.grip;
    const pose = sampleTrack(driver.progress, 0);
    const vehicle = {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: 0.5,
    };

    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        const point = sampleTrack(progress, 0);
        return {
          progress,
          laneOffset: 0,
          targetSpeed: 40,
          worldX: point.x,
          worldY: point.y,
          bodyHeading: point.heading,
          headingOffset: 0,
          yawRate: 0,
          tireGrip: grip,
          longitudinalAcceleration: -8,
          forwardAcceleration: -10,
        };
      }),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.debug.profileBrake).toBeGreaterThan(0.1);
    expect(control.brake).toBe(0);
    expect(control.throttle).toBeGreaterThan(0.4);
    expect(control.targetSpeed).toBeGreaterThan(20);
  });

});
