import { raceDistance } from './RaceModel';

export interface RaceIntervalSource {
  id: string;
  lap: number;
  progress: number;
}

interface PreviousSample {
  distance: number;
  time: number;
}

/**
 * Timing tower gaps should represent when cars crossed the same piece of track,
 * not distance divided by whatever speed they happen to have in a braking zone.
 * We emulate timing loops around the circuit and interpolate the crossing time
 * between fixed simulation ticks. With 300 loops per lap, the displayed gap
 * refreshes several times per second while remaining a genuine time interval.
 */
export class RaceIntervalTracker {
  private readonly gatesPerLap: number;
  private readonly previous = new Map<string, PreviousSample>();
  private readonly crossings = new Map<string, Map<number, number>>();

  constructor(gatesPerLap = 300) {
    this.gatesPerLap = Math.max(60, Math.round(gatesPerLap));
  }

  reset(): void {
    this.previous.clear();
    this.crossings.clear();
  }

  update(cars: readonly RaceIntervalSource[], raceTime: number): void {
    if (!Number.isFinite(raceTime)) return;

    for (const car of cars) {
      const distance = raceDistance(car.lap, car.progress);
      const previous = this.previous.get(car.id);
      if (!previous) {
        this.previous.set(car.id, { distance, time: raceTime });
        continue;
      }

      // Recovery or a state correction may move a body backwards. Never invent
      // timing-loop crossings across that jump; start a fresh interpolation
      // segment from the corrected position instead.
      if (distance <= previous.distance) {
        this.previous.set(car.id, { distance, time: raceTime });
        continue;
      }

      const firstGate = Math.floor(previous.distance * this.gatesPerLap) + 1;
      const lastGate = Math.floor(distance * this.gatesPerLap);
      if (lastGate >= firstGate) {
        let carCrossings = this.crossings.get(car.id);
        if (!carCrossings) {
          carCrossings = new Map<number, number>();
          this.crossings.set(car.id, carCrossings);
        }

        const distanceDelta = distance - previous.distance;
        const timeDelta = raceTime - previous.time;
        for (let gate = firstGate; gate <= lastGate; gate++) {
          const gateDistance = gate / this.gatesPerLap;
          const alpha = Math.max(0, Math.min(1, (gateDistance - previous.distance) / distanceDelta));
          carCrossings.set(gate, previous.time + timeDelta * alpha);
        }
      }

      this.previous.set(car.id, { distance, time: raceTime });
    }
  }

  /** Signed from the reference driver's point of view: ahead = negative. */
  gapSeconds(reference: RaceIntervalSource, other: RaceIntervalSource): number | undefined {
    if (reference.id === other.id) return 0;
    const referenceCrossings = this.crossings.get(reference.id);
    const otherCrossings = this.crossings.get(other.id);
    if (!referenceCrossings || !otherCrossings) return undefined;

    const trailingDistance = Math.min(
      raceDistance(reference.lap, reference.progress),
      raceDistance(other.lap, other.progress),
    );
    let gate = Math.floor(trailingDistance * this.gatesPerLap);

    // Usually the first gate exists. Looking back a short distance makes the
    // display robust to a reset/pit state correction without using stale laps.
    for (let attempt = 0; attempt < 18 && gate >= 0; attempt++, gate--) {
      const referenceTime = referenceCrossings.get(gate);
      const otherTime = otherCrossings.get(gate);
      if (referenceTime !== undefined && otherTime !== undefined) {
        return otherTime - referenceTime;
      }
    }
    return undefined;
  }
}

export function estimatedSignedGapSeconds(
  reference: RaceIntervalSource,
  other: RaceIntervalSource,
  representativeLapSeconds: number,
): number {
  const distanceDelta = raceDistance(reference.lap, reference.progress) - raceDistance(other.lap, other.progress);
  return distanceDelta * Math.max(1, representativeLapSeconds);
}

export function formatSignedRaceGap(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (Math.abs(seconds) < 0.0005) return '0.000';
  if (seconds <= -99.5) return '<-99.9';
  if (seconds >= 99.5) return '>+99.9';
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(3)}`;
}
