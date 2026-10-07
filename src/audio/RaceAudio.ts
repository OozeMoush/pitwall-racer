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
  contactKind?: 'NONE' | 'CAR' | 'BARRIER';
  impactSpeed?: number;
  inactive?: boolean;
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
export class ContactAudioGate {
  private touching = false;
  update(kind = 'NONE', impactSpeed = 0): number {
    const contact = kind !== 'NONE';
    const amount = contact && !this.touching && impactSpeed > 2 ? clamp01(impactSpeed / 22) : 0;
    this.touching = contact;
    return amount;
  }
  reset(): void { this.touching = false; }
}

let audioVolume = 1;
export function getRaceAudioVolume(): number { return audioVolume; }
export function setRaceAudioVolume(value: number): void {
  audioVolume = Number.isFinite(value) ? clamp01(value) : 0;
  window.dispatchEvent(new Event('race-audio-volume'));
}

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
  private readonly contacts = new ContactAudioGate();
  private paused = false;
  private inactive = false;
  private readonly transients = new Set<OscillatorNode>();
  private readonly onPause = (event: Event) => {
    this.paused = (event as CustomEvent<boolean>).detail;
    this.clearTransients();
    this.applyVolume();
  };
  private readonly onVolume = () => this.applyVolume();

  constructor() {
    window.addEventListener('race-audio-pause', this.onPause);
    window.addEventListener('race-audio-volume', this.onVolume);
  }

  private applyVolume(): void {
    if (!this.context || !this.master) return;
    const gain = this.paused || this.inactive ? 0 : 0.42 * audioVolume;
    this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.015);
  }

  private clearTransients(): void {
    for (const node of this.transients) { node.stop(); node.disconnect(); }
    this.transients.clear();
  }

  dispose(): void {
    window.removeEventListener('race-audio-pause', this.onPause);
    window.removeEventListener('race-audio-volume', this.onVolume);
    this.clearTransients();
    void this.context?.close().catch(() => {});
  }

  unlock(): void {
    if (!this.context) this.createGraph();
    if (!this.paused) void this.context?.resume().catch(() => {});
  }

  update(input: RaceAudioInput, dt: number): void {
    const context = this.context;
    if (!context || context.state === 'closed') return;
    this.inactive = input.inactive ?? false;
    this.applyVolume();
    if (this.paused || this.inactive) {
      this.lastBanner = input.banner;
      this.contacts.update(input.contactKind, input.impactSpeed);
      return;
    }
    const now = context.currentTime;
    const params = raceAudioParameters(input);

    this.engineA?.frequency.setTargetAtTime(params.engineFrequency, now, 0.025);
    this.engineB?.frequency.setTargetAtTime(params.engineFrequency * 1.985, now, 0.03);
    this.engineGain?.gain.setTargetAtTime(params.engineGain, now, 0.035);
    this.engineFilter?.frequency.setTargetAtTime(520 + clamp01(input.speed / 112) * 2100 + input.throttle * 850, now, 0.045);
    this.tireGain?.gain.setTargetAtTime(params.tireGain, now, 0.025);
    this.surfaceGain?.gain.setTargetAtTime(params.surfaceGain, now, 0.04);

    if (input.banner !== this.lastBanner) {
      if (input.banner?.startsWith('RED_')) this.beep(440, 0.075, 0.07);
      if (input.banner === 'LIGHTS_OUT') this.beep(780, 0.12, 0.11);
      this.lastBanner = input.banner;
    }

    const impact = this.contacts.update(input.contactKind, input.impactSpeed);
    if (impact > 0) this.thump(impact);
  }

  reset(): void {
    this.lastBanner = undefined;
    this.contacts.reset();
    this.clearTransients();
    this.inactive = false;
    this.applyVolume();
  }

  private createGraph(): void {
    const context = new AudioContext({ latencyHint: 'interactive' });
    const master = context.createGain();
    master.gain.value = this.paused ? 0 : 0.42 * audioVolume;
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
    this.transients.add(osc);
    osc.onended = () => { osc.disconnect(); level.disconnect(); this.transients.delete(osc); };
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
    this.transients.add(osc);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.transients.delete(osc); };
    osc.start();
    osc.stop(context.currentTime + 0.1);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
