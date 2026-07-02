type SoundName =
  | "button"
  | "capture"
  | "diceLand"
  | "diceRoll"
  | "move"
  | "notification"
  | "spawn"
  | "success"
  | "turn"
  | "victory";

class GameAudio {
  private context?: AudioContext;
  private muted = false;
  private lastPlayed = new Map<SoundName, number>();

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  unlock() {
    void this.getContext()?.resume();
  }

  play(name: SoundName, delayMs = 0) {
    if (this.muted) return;
    const run = () => this.playNow(name);
    if (delayMs > 0) window.setTimeout(run, delayMs);
    else run();
  }

  playSteps(count: number) {
    const capped = Math.min(6, Math.max(0, count));
    for (let i = 0; i < capped; i += 1) this.play("move", i * 95);
  }

  private playNow(name: SoundName) {
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < 40) return;
    this.lastPlayed.set(name, now);

    const context = this.getContext();
    if (!context) return;
    const t = context.currentTime;
    switch (name) {
      case "diceRoll":
        this.noise(context, t, 0.22, 0.055, 520, 900);
        this.tone(context, t, 0.09, 190, 0.035, "triangle");
        this.tone(context, t + 0.06, 0.1, 260, 0.03, "triangle");
        break;
      case "diceLand":
        this.tone(context, t, 0.12, 130, 0.05, "sine");
        this.tone(context, t + 0.035, 0.12, 220, 0.035, "sine");
        break;
      case "success":
        this.tone(context, t, 0.07, 640, 0.035, "sine");
        this.tone(context, t + 0.055, 0.08, 900, 0.028, "sine");
        break;
      case "move":
        this.tone(context, t, 0.045, 420, 0.024, "sine");
        break;
      case "spawn":
        this.tone(context, t, 0.08, 560, 0.045, "triangle");
        this.tone(context, t + 0.055, 0.09, 760, 0.035, "triangle");
        break;
      case "capture":
        this.noise(context, t, 0.18, 0.08, 180, 420);
        this.tone(context, t, 0.16, 110, 0.09, "sawtooth");
        this.tone(context, t + 0.08, 0.12, 70, 0.055, "sine");
        break;
      case "turn":
        this.tone(context, t, 0.08, 520, 0.025, "sine");
        this.tone(context, t + 0.055, 0.1, 660, 0.025, "sine");
        break;
      case "victory":
        [523, 659, 784, 1047].forEach((freq, index) => this.tone(context, t + index * 0.12, 0.18, freq, 0.045, "triangle"));
        break;
      case "notification":
        this.tone(context, t, 0.08, 780, 0.025, "sine");
        break;
      case "button":
        this.tone(context, t, 0.035, 680, 0.018, "sine");
        break;
    }
  }

  private getContext() {
    if (this.muted) return undefined;
    const AudioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return undefined;
    this.context ??= new AudioContextConstructor();
    return this.context;
  }

  private tone(context: AudioContext, start: number, duration: number, frequency: number, gainValue: number, type: OscillatorType) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(context: AudioContext, start: number, duration: number, gainValue: number, low: number, high: number) {
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(high, start);
    filter.frequency.exponentialRampToValueAtTime(low, start + duration);
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(start);
  }
}

export const gameAudio = new GameAudio();
