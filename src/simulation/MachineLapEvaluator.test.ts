import { describe, expect, it } from 'vitest';
import { dynamicAiControl } from './DynamicAiController';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { createAiField } from './RaceModel';
import { compoundPeakGrip, createTire } from './TireModel';

const CORE_POWER_BOOST = 0.22;

describe('executable machine lap evaluator', () => {
  it('replays the current clean reference controller as a full dynamic lap', () => {
    const driver = createAiField()[0];
    driver.lap = 0;
    driver.progress = 0.08;
    driver.laneOffset = 0;
    driver.battleState = 'CLEAR';
    driver.tire = {
      ...createTire('SOFT'),
      grip: compoundPeakGrip('SOFT', 'PUSH'),
      wear: 0,
      temperature: 103,
    };

    const result = evaluateMachineFlyingLap({
      trackId: 'pitwall-gp',
      startProgress: driver.progress,
      policy: ({ state, projection, completedLaps }) => {
        const speed = Math.hypot(state.vx, state.vy);
        driver.progress = projection.progress;
        driver.laneOffset = projection.laneOffset;
        driver.speed = speed;
        driver.lap = completedLaps;
        const control = dynamicAiControl(driver, {
          x: state.x,
          y: state.y,
          heading: state.heading,
          speed,
          yawRate: state.yawRate,
        }, []);
        driver.battleState = control.battleState;
        return {
          throttle: control.throttle,
          brake: control.brake,
          steer: control.steer,
          tireGrip: driver.tire.grip,
          surfaceGrip: 1,
          powerBoost: CORE_POWER_BOOST,
          powerMultiplier: 1,
          rollingResistance: 0,
        };
      },
    });

    console.log('EXECUTABLE_REFERENCE_BASELINE', JSON.stringify({
      completed: result.completed,
      lapSeconds: Number((result.lapSeconds ?? 0).toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
      illegalRatio: Number((result.illegalSamples / Math.max(1, result.samples)).toFixed(4)),
      averageKmh: Number((result.averageSpeed * 3.6).toFixed(1)),
      maxKmh: Number((result.maxSpeed * 3.6).toFixed(1)),
    }));

    expect(result.completed).toBe(true);
    expect(result.lapSeconds!).toBeGreaterThan(25);
    expect(result.lapSeconds!).toBeLessThan(33);
    expect(result.illegalSamples / Math.max(1, result.samples)).toBeLessThan(0.01);
  }, 15_000);
});
