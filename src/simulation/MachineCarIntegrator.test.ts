import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MACHINE_PHYSICS_DT,
  machineStateFromVehicle,
  machineStateSpeed,
  stepMachineCar,
} from './MachineCarIntegrator';
import { RapierRacePhysics } from './RapierRacePhysics';
import { sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

describe('machine car integrator', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('tracks the clean Rapier chassis under identical open-loop inputs', () => {
    const pose = sampleTrack(0.18, 0);
    const start = {
      ...createVehicle(pose.x, pose.y, pose.heading),
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
});

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}
