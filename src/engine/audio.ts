/**
 * 极简 WebAudio 音效合成器 — 不加载任何音频素材，
 * 全部音效由振荡器现场合成，保持零依赖零资源。
 */
export type SfxName =
  | 'hit'
  | 'hurt'
  | 'kill'
  | 'pickup'
  | 'quaff'
  | 'stairs'
  | 'die'
  | 'levelup'
  | 'zap'
  | 'teleport';

interface SfxPreset {
  type: OscillatorType;
  from: number;
  to: number;
  dur: number;
  vol: number;
}

const PRESETS: Record<SfxName, SfxPreset> = {
  hit: { type: 'square', from: 220, to: 110, dur: 0.08, vol: 0.12 },
  hurt: { type: 'sawtooth', from: 160, to: 80, dur: 0.12, vol: 0.14 },
  kill: { type: 'square', from: 330, to: 55, dur: 0.2, vol: 0.16 },
  pickup: { type: 'triangle', from: 440, to: 880, dur: 0.12, vol: 0.14 },
  quaff: { type: 'sine', from: 300, to: 520, dur: 0.15, vol: 0.14 },
  stairs: { type: 'sine', from: 200, to: 400, dur: 0.25, vol: 0.14 },
  die: { type: 'sawtooth', from: 200, to: 40, dur: 0.6, vol: 0.22 },
  levelup: { type: 'triangle', from: 523, to: 1046, dur: 0.3, vol: 0.16 },
  zap: { type: 'sawtooth', from: 800, to: 100, dur: 0.25, vol: 0.16 },
  teleport: { type: 'sine', from: 700, to: 1400, dur: 0.2, vol: 0.14 },
};

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

export function playSfx(name: SfxName): void {
  if (muted) return;
  try {
    // AudioContext 必须在用户手势后创建/恢复，首次按键即满足
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const preset = PRESETS[name];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = preset.type;
    osc.frequency.setValueAtTime(preset.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, preset.to), t + preset.dur);
    gain.gain.setValueAtTime(preset.vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + preset.dur);
    osc.start(t);
    osc.stop(t + preset.dur + 0.02);
  } catch {
    // 无音频设备/上下文时静默降级
  }
}
