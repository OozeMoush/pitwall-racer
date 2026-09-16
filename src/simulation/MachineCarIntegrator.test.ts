import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MACHINE_PHYSICS_DT,
  createMachineTyreSlideState,
  machineStateFromVehicle,
  machineStateSpeed,
  stepMachineCar,
  stepMachineCarWithTyre,
} from './MachineCarIntegrator';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createVehicle } from './VehicleModel';

describe('machine car integrator', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('tracks the clean Rapier chassis under identical open-loop inputs', () => {
    // Keep this comparison far outside the circuit. The purpose is to compare
    // chassis integration only; putting a fixed-steer car on the real track can
    // make the Rapier copy hit a safety barrier while the lightweight optimiser
    // (which intentionally has no collision world) keeps travelling freely.
    const start = {
      ...createVehicle(4000, 4000, 0.37),
      speed: 62,
      yawRate: 0.08,
    };
    const physics = new RapierRacePhysics(start, []);
    physics.setPlayerState(start);
    let machine = machineStateFromVehicle(start);

    const input = {
      throttle: 0.68,
      brake: 0,
      steer: 0.14,
      tireGrip: 1.10,
      surfaceGrip: 1,
      powerBoost: 0.22,
      powerMultiplier: 1,
      rollingResistance: 0,
    };

    for (let tick = 0; tick < 2 / MACHINE_PHYSICS_DT; tick++) {
      physics.drivePlayer(input, MACHINE_PHYSICS_DT);
      physics.step(MACHINE_PHYSICS_DT);
      machine = stepMachineCar(machine, input, MACHINE_PHYSICS_DT);
    }

    const rapier = physics.playerState();
    const positionError = Math.hypot(machine.x - rapier.x, machine.y - rapier.y);
    const speedError = Math.abs(machineStateSpeed(machine) - rapier.speed);
    const headingError = Math.abs(wrapAngle(machine.heading - rapier.heading));
    const yawError = Math.abs(machine.yawRate - rapier.yawRate);

    console.log('MACHINE_INTEGRATOR_PARITY', JSON.stringify({
      positionError: Number(positionError.toFixed(4)),
      speedError: Number(speedError.toFixed(4)),
      headingError: Number(headingError.toFixed(5)),
      yawError: Number(yawError.toFixed(5)),
    }));

    expect(positionError).toBeLessThan(0.75);
    expect(speedError).toBeLessThan(0.12);
    expect(headingError).toBeLessThan(0.012);
    expect(yawError).toBeLessThan(0.012);
  });

  it('matches Rapier when worn tyres trigger the stateful rear-slide model', () => {
    const start = {
      ...createVehicle(5000, 5000, -0.21),
      speed: 100,
      yawRate: 0.05,
    };
    const physics = new RapierRacePhysics(start, []);
    physics.setPlayerState(start);
    let machine = machineStateFromVehicle(start);
    let slideState = createMachineTyreSlideState(0.37);
    let machineTriggered = 0;
    let peakMachineSlide = 0;
    let peakRapierSlide = 0;

    // Deliberately unrealistic sustained load. This is not a handling test: it
    // exists to guarantee the hidden slide state actually crosses its threshold
    // quickly enough that both integrators exercise the same transient branch.
    const input = {
      throttle: 1,
      brake: 0,
      steer: 1,
      tireGrip: 1.03,
      surfaceGrip: 1,
      powerBoost: 0.22,
      powerMultiplier: 1,
      rollingResistance: 0,
    };
    const tireWear = 1;

    for (let tick = 0; tick < 3 / MACHINE_PHYSICS_DT; tick++) {
      physics.drivePlayer({ ...input, tireWear }, MACHINE_PHYSICS_DT);
      physics.step(MACHINE_PHYSICS_DT);
      peakRapierSlide = Math.max(peakRapierSlide, physics.playerSlideSeverity());
      const machineStep = stepMachineCarWithTyre(
        machine,
        slideState,
        input,
        tireWear,
        MACHINE_PHYSICS_DT,
      );
      machine = machineStep.state;
      slideState = machineStep.slideState;
      if (machineStep.slideTriggered) machineTriggered += 1;
      peakMachineSlide = Math.max(peakMachineSlide, machineStep.slideSeverity);
    }

    const rapier = physics.playerState();
    const positionError = Math.hypot(machine.x - rapier.x, machine.y - rapier.y);
    const speedError = Math.abs(machineStateSpeed(machine) - rapier.speed);
    const headingError = Math.abs(wrapAngle(machine.heading - rapier.heading));
    const yawError = Math.abs(machine.yawRate - rapier.yawRate);

    console.log('MACHINE_TYRE_SLIDE_PARITY', JSON.stringify({
      machineTriggered,
      peakMachineSlide: Number(peakMachineSlide.toFixed(3)),
      peakRapierSlide: Number(peakRapierSlide.toFixed(3)),
      positionError: Number(positionError.toFixed(4)),
      speedError: Number(speedError.toFixed(4)),
      headingError: Number(headingError.toFixed(5)),
      yawError: Number(yawError.toFixed(5)),
    }));

    expect(machineTriggered).toBeGreaterThan(0);
    expect(peakMachineSlide).toBeGreaterThan(0.25);
    expect(peakRapierSlide).toBeGreaterThan(0.25);
    expect(Math.abs(peakMachineSlide - peakRapierSlide)).toBeLessThan(0.02);
    expect(positionError).toBeLessThan(1.5);
    expect(speedError).toBeLessThan(0.35);
    expect(headingError).toBeLessThan(0.025);
    expect(yawError).toBeLessThan(0.025);
  });
});

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}
