export type VadOptions = {
  sampleRate: number;
  silenceMs: number;
  minSpeechMs: number;
  maxSpeechMs: number;
  levelThreshold: number;
  preRollMs: number;
  previewDelayMs?: number;
  onPreview?: (pcm: Int16Array, epoch: number) => void;
  onPreviewCancel?: () => void;
};

/** Root-mean-square level in the range 0..1. */
export function pcmRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const n = samples[i]! / 32768;
    sum += n * n;
  }
  return Math.sqrt(sum / samples.length);
}

export class UtteranceDetector {
  private inSpeech = false;
  private preRoll: Int16Array[] = [];
  private preRollSamples = 0;
  private collected: Int16Array[] = [];
  private speechSamples = 0;
  private silenceSamples = 0;
  private epoch = 0;
  private sentPreview = false;
  lastEpoch = 0;

  constructor(private readonly opts: VadOptions) {}

  reset(): void {
    this.inSpeech = false;
    this.preRoll = [];
    this.preRollSamples = 0;
    this.collected = [];
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.sentPreview = false;
  }

  push(chunk: Int16Array): Int16Array | null {
    if (chunk.length === 0) return null;
    const rms = pcmRms(chunk);

    if (!this.inSpeech) {
      this.preRoll.push(chunk);
      this.preRollSamples += chunk.length;
      this.trimPreRoll();
      if (rms < this.opts.levelThreshold) return null;
      this.inSpeech = true;
      this.epoch += 1;
      this.sentPreview = false;
      this.collected = this.preRoll;
      this.preRoll = [];
      this.preRollSamples = 0;
      this.speechSamples = chunk.length;
      this.silenceSamples = 0;
      return this.finishIfReady();
    }

    this.collected.push(chunk);
    if (rms >= this.opts.levelThreshold) {
      if (this.silenceSamples > 0) {
        this.epoch += 1;
        this.sentPreview = false;
        this.opts.onPreviewCancel?.();
      }
      this.speechSamples += chunk.length;
      this.silenceSamples = 0;
    } else {
      this.silenceSamples += chunk.length;
      this.maybePreview();
    }
    return this.finishIfReady();
  }

  private maybePreview(): void {
    const minSpeech = msToSamples(this.opts.minSpeechMs, this.opts.sampleRate);
    const previewDelay = msToSamples(this.opts.previewDelayMs ?? 0, this.opts.sampleRate);
    if (this.sentPreview || this.speechSamples < minSpeech || this.silenceSamples < previewDelay) return;
    this.sentPreview = true;
    this.opts.onPreview?.(concatPcm(this.collected), this.epoch);
  }

  private trimPreRoll(): void {
    const max = Math.floor((this.opts.sampleRate * this.opts.preRollMs) / 1000);
    while (this.preRollSamples > max && this.preRoll.length > 1) {
      const dropped = this.preRoll.shift();
      if (!dropped) break;
      this.preRollSamples -= dropped.length;
    }
  }

  private finishIfReady(): Int16Array | null {
    const silenceLimit = msToSamples(this.opts.silenceMs, this.opts.sampleRate);
    const maxSamples = msToSamples(this.opts.maxSpeechMs, this.opts.sampleRate);
    const total = this.collected.reduce((n, chunk) => n + chunk.length, 0);
    if (this.silenceSamples < silenceLimit && total < maxSamples) return null;

    const minSpeech = msToSamples(this.opts.minSpeechMs, this.opts.sampleRate);
    const speechSamples = this.speechSamples;
    const pcm = concatPcm(this.collected);
    this.lastEpoch = this.epoch;
    this.reset();
    if (speechSamples < minSpeech) return null;
    return pcm;
  }
}

function msToSamples(ms: number, sampleRate: number): number {
  return Math.floor((sampleRate * ms) / 1000);
}

function concatPcm(chunks: Int16Array[]): Int16Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Int16Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
