import { CONFIG } from "./config";

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private muted = false;
  private noiseBuffer: AudioBuffer | null = null;

  get isMuted(): boolean {
    return this.muted;
  }

  ensure(): void {
    if (typeof window === "undefined") return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : CONFIG.audio.masterGain;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoiseBuffer(this.ctx);
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : CONFIG.audio.masterGain,
        this.ctx.currentTime,
        0.02,
      );
    }
    return this.muted;
  }

  setEngine(active: boolean, speed: number, boosting: boolean): void {
    this.ensure();
    if (!this.ctx || !this.master) return;

    if (!active) {
      if (this.engineGain) {
        this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
      return;
    }

    if (!this.engineOsc) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.engineOsc = osc;
      this.engineGain = gain;
      this.engineFilter = filter;
    }

    const t = this.ctx.currentTime;
    const freq = 55 + speed * (boosting ? 4.4 : 2.8);
    const cutoff = boosting ? 1800 : 900;
    this.engineOsc?.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineFilter?.frequency.setTargetAtTime(cutoff, t, 0.08);
    this.engineGain?.gain.setTargetAtTime(boosting ? 0.12 : 0.07, t, 0.05);
  }

  nitroWhoosh(): void {
    this.noiseBurst({ duration: 0.28, gain: 0.22, startFreq: 1800, endFreq: 400, q: 0.7 });
  }

  crash(): void {
    this.noiseBurst({ duration: 0.55, gain: 0.45, startFreq: 900, endFreq: 80, q: 1.2 });
    this.playNotes([110, 82, 55], 0.16, "square", 0.08);
  }

  nearMiss(): void {
    this.playNotes([880, 1320], 0.05, "square", 0.07);
  }

  startJingle(): void {
    this.playNotes([392, 523, 659], 0.11, "square", 0.09);
  }

  gameOverJingle(): void {
    this.playNotes([392, 311, 247], 0.18, "sawtooth", 0.1);
  }

  dispose(): void {
    try {
      this.engineOsc?.stop();
    } catch {
      // already stopped
    }
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.noiseBuffer = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }

  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private noiseBurst(opts: {
    duration: number;
    gain: number;
    startFreq: number;
    endFreq: number;
    q: number;
  }): void {
    this.ensure();
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = opts.q;
    filter.frequency.setValueAtTime(opts.startFreq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.endFreq), t + opts.duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + opts.duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + opts.duration + 0.02);
  }

  private playNotes(
    freqs: number[],
    step: number,
    type: OscillatorType,
    volume: number,
  ): void {
    this.ensure();
    if (!this.ctx || !this.master) return;
    freqs.forEach((freq, i) => {
      const t = this.ctx!.currentTime + i * step;
      const osc = this.ctx!.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      const gain = this.ctx!.createGain();
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + step * 0.9);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(t);
      osc.stop(t + step);
    });
  }
}
