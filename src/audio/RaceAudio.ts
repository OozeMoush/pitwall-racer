export interface RaceAudioInput {
  speed: number;
  throttle: number;
  brake: number;
  steer: number;
  tireGrip: number;
  surfaceSeverity: number;
  trafficPressure: number;
  pitService: boolean;
  slideSeverity?: number;
  banner?: string;
}

export interface RaceAudioParameters {
  engineFrequency: number;
  engineGain: number;
  tireGain: number;
  surfaceGain: number;
}

export function raceAudioParameters(input: RaceAudioInput): RaceAudioParameters {
  const speed = clamp01(input.speed / 112);
  const load = clamp01(input.throttle * 0.78 + speed * 0.38);
  const engineFrequency = 58 + speed * 245 + load * 34;
  const engineGain = input.pitService ? 0.025 : 0.035 + speed * 0.055 + input.throttle * 0.035;

  // Ordinary steering stays quiet. Limit noise still exists for a genuinely
  // hard high-speed input or braking, but wear itself no longer creates a
  // permanent hiss. A rear-slide event gets its own short, unmistakable burst.
  const steeringStress = Math.abs(input.steer) * speed * Math.max(0.24, 0.78 - input.tireGrip * 0.36);
  const brakingStress = input.brake * speed;
  const limitDemand = clamp01((steeringStress + brakingStress - 0.61) * 3.0);
  const slideSeverity = clamp01(input.slideSeverity ?? 0);
  const limitGain = limitDemand * 0.068;
  const slideGain = slideSeverity * (0.052 + speed * 0.040);
  const tireGain = speed < 0.2 ? 0 : Math.max(limitGain, slideGain);

  const surfaceGain = clamp01(input.surfaceSeverity) * (0.025 + speed * 0.075);
  return { engineFrequency, engineGain, tireGain, surfaceGain };
}

/**
 * Small Web Audio sound layer. It deliberately starts with procedural sound so
 * gameplay feedback can be tuned without blocking on licensed/recorded assets.
 * Browsers require a user gesture before audio starts; unlock() is therefore
 * called from the first keyboard/pointer input.
 */
export class RaceAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private engineA?: OscillatorNode;
  private engineB?: OscillatorNode;
  private tireGain?: GainNode;
  private surfaceGain?: GainNode;
  private lastBanner?: string;
  private lastSpeed = 0;
  private collisionCooldown = 0;

  unlock(): void {
    if (!this.context) this.createGraph();
    void this.context?.resume();
  }

  update(input: RaceAudioInput, dt: number): void {
    const context = this.context;
    if (!context || context.state === 'closed') return;
    const now = context.currentTime;
    const params = raceAudioParameters(input);

    this.engineA?.frequency.setTargetAtTime(params.engineFrequency, now, 0.025);
    this.engineB?.frequency.setTargetAtTime(params.engineFrequency * 1.985, now, 0.03);
    this.engineGain?.gain.setTargetAtTime(params.engineGain, now, 0.035);
    this.engineFilter?.frequency.setTargetAtTime(520 + clamp01(input.speed / 112) * 2100 + input.throttle * 850, now, 0.045);
    this.tireGain?.gain.setTargetAtTime(params.tireGain, now, 0.025);
    this.surfaceGain?.gain.setTargetAtTime(params.surfaceGain, now, 0.04);

    if (input.banner !== this.lastBanner) {
      if (input.banner === '3' || input.banner === '2' || input.banner === '1') this.beep(440, 0.075, 0.07);
      if (input.banner === 'GO') this.beep(780, 0.12, 0.11);
      this.lastBanner = input.banner;
    }

    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    const speedDrop = this.lastSpeed - input.speed;
    if (speedDrop > 8 && input.trafficPressure > 0.28 && this.collisionCooldown === 0) {
      this.thump(Math.min(1, speedDrop / 22));
      this.collisionCooldown = 0.18;
    }
    this.lastSpeed = input.speed;
  }

  reset(): void {
    this.lastBanner = undefined;
    this.lastSpeed = 0;
    this.collisionCooldown = 0;
  }

  private createGraph(): void {
    const context = new AudioContext({ latencyHint: 'interactive' });
    const master = context.createGain();
    master.gain.value = 0.42;
    master.connect(context.destination);

    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 1200;
    engineFilter.Q.value = 0.8;
    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain).connect(master);

    const engineA = context.createOscillator();
    engineA.type = 'sawtooth';
    const engineAGain = context.createGain();
    engineAGain.gain.value = 0.55;
    engineA.connect(engineAGain).connect(engineFilter);

    const engineB = context.createOscillator();
    engineB.type = 'triangle';
    const engineBGain = context.createGain();
    engineBGain.gain.value = 0.23;
    engineB.connect(engineBGain).connect(engineFilter);
    engineA.start();
    engineB.start();

    const noise = this.createNoise(context);
    const tireFilter = context.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 1450;
    tireFilter.Q.value = 0.75;
    const tireGain = context.createGain();
    tireGain.gain.value = 0;
    noise.connect(tireFilter).connect(tireGain).connect(master);

    const surfaceFilter = context.createBiquadFilter();
    surfaceFilter.type = 'lowpass';
    surfaceFilter.frequency.value = 680;
    const surfaceGain = context.createGain();
    surfaceGain.gain.value = 0;
    noise.connect(surfaceFilter).connect(surfaceGain).connect(master);
    noise.start();

    this.context = context;
    this.master = master;
    this.engineGain = engineGain;
    this.engineFilter = engineFilter;
    this.engineA = engineA;
    this.engineB = engineB;
    this.tireGain = tireGain;
    this.surfaceGain = surfaceGain;
  }

  private createNoise(context: AudioContext): AudioBufferSourceNode {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  private beep(frequency: number, duration: number, gain: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const osc = context.createOscillator();
    const level = context.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    level.gain.setValueAtTime(gain, context.currentTime);
    level.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    osc.connect(level).connect(master);
    osc.start();
    osc.stop(context.currentTime + duration);
  }

  private thump(amount: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(48, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.12 * amount, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.09);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(context.currentTime + 0.1);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
