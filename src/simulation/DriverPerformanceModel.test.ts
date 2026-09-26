import { describe, expect, it } from 'vitest';
import { driverPerformanceAt, driverPerformanceProfile } from './DriverPerformanceModel';
import { createAiField } from './RaceModel';

describe('DriverPerformanceModel', () => {
  it('gives the strongest CPU the highest average pace and precision', () => {
    const field = createAiField();
    const apex = field.find((driver) => driver.name === 'APEX')!;
    const rift = field.find((driver) => driver.name === 'RIFT')!;

    expect(driverPerformanceProfile(apex).pace)
      .toBeGreaterThan(driverPerformanceProfile(rift).pace);
    expect(driverPerformanceProfile(apex).precision)
      .toBeGreaterThan(driverPerformanceProfile(rift).precision);
    expect(driverPerformanceProfile(apex).consistency)
      .toBeLessThan(driverPerformanceProfile(rift).consistency);
  });

  it('never asks a race CPU to reproduce more than the perfect reference execution', () => {
    for (const driver of createAiField()) {
      for (let sample = 0; sample < 80; sample++) {
        const progress = sample / 80;
        const result = driverPerformanceAt(driver, progress, 0.75);
        expect(result.executionFactor).toBeLessThan(1);
        expect(result.executionFactor).toBeGreaterThan(0.94);
      }
    }
  });

  it('changes smoothly instead of injecting frame-to-frame random noise', () => {
    const apex = createAiField().find((driver) => driver.name === 'APEX')!;
    apex.lap = 8;

    let previous = driverPerformanceAt(apex, 0.2, 0.55).executionFactor;
    let maxStep = 0;
    for (let index = 1; index <= 120; index++) {
      const progress = 0.2 + index / 12000;
      const next = driverPerformanceAt(apex, progress, 0.55).executionFactor;
      maxStep = Math.max(maxStep, Math.abs(next - previous));
      previous = next;
    }

    expect(maxStep).toBeLessThan(0.00015);
  });

  it('lets form vary across a stint while preserving the driver hierarchy on average', () => {
    const field = createAiField();
    const apex = field.find((driver) => driver.name === 'APEX')!;
    const rift = field.find((driver) => driver.name === 'RIFT')!;
    const apexSamples: number[] = [];
    const riftSamples: number[] = [];

    for (let lap = 1; lap <= 12; lap++) {
      apex.lap = lap;
      rift.lap = lap;
      for (const progress of [0.1, 0.4, 0.7]) {
        apexSamples.push(driverPerformanceAt(apex, progress, 0.35).executionFactor);
        riftSamples.push(driverPerformanceAt(rift, progress, 0.35).executionFactor);
      }
    }

    const average = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;

    expect(Math.max(...apexSamples) - Math.min(...apexSamples)).toBeGreaterThan(0.002);
    expect(Math.max(...riftSamples) - Math.min(...riftSamples)).toBeGreaterThan(0.004);
    expect(average(apexSamples)).toBeGreaterThan(average(riftSamples) + 0.008);
  });

  it('uses precision to leave a little more margin in technical sections', () => {
    const rift = createAiField().find((driver) => driver.name === 'RIFT')!;
    rift.lap = 4;

    const straight = driverPerformanceAt(rift, 0.42, 0.05);
    const technical = driverPerformanceAt(rift, 0.42, 0.95);

    expect(technical.executionFactor).toBeLessThan(straight.executionFactor);
    expect(straight.executionFactor - technical.executionFactor).toBeLessThan(0.02);
  });
});
