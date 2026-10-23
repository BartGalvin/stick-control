/*
The JavaScript below is adapted from Chris Wilson, Metronome, (2014), GitHub repository https://github.com/cwilso/metronome

The MIT License (MIT)

Copyright (c) 2014 Chris Wilson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const TICKS_PER_PATTERN = 32;

export function advance(position, repeats, patternCount) {
  if (position.tick < TICKS_PER_PATTERN - 1) {
    return { pattern: position.pattern, repeat: position.repeat, tick: position.tick + 1 };
  }
  if (position.repeat < repeats) {
    return { pattern: position.pattern, repeat: position.repeat + 1, tick: 0 };
  }
  return { pattern: (position.pattern + 1) % patternCount, repeat: 1, tick: 0 };
}

export class PracticePlayer {
  constructor({ context, worker, patternCount, pattern = 0, onStep = () => {} }) {
    this.context = context;
    this.worker = worker;
    this.patternCount = patternCount;
    this.onStep = onStep;
    this.settings = { tempo: 60, repeats: 20, subdivision: 2 };
    this.position = { pattern, repeat: 1, tick: -1 };
    this.playing = false;
    this.starting = false;
    this.elapsedBeforeStart = 0;
    this.generation = 0;
    this.queue = [];
    this.oscillators = new Set();
    worker.onmessage = () => this.schedule();
  }

  setSettings(settings) {
    const next = { ...this.settings, ...settings };
    if (!Number.isInteger(next.tempo) || next.tempo < 20 || next.tempo > 160
      || !Number.isInteger(next.repeats) || next.repeats < 1 || next.repeats > 40
      || ![1, 2, 4].includes(next.subdivision)) {
      throw new RangeError("Invalid practice settings");
    }
    this.settings = next;
  }

  get elapsed() {
    return this.elapsedBeforeStart + (this.playing ? this.context.currentTime - this.startedAt : 0);
  }

  async start() {
    if (this.playing || this.starting) return;
    const generation = ++this.generation;
    this.starting = true;
    try {
      await this.context.resume();
      if (generation !== this.generation) return;
      if (this.context.state !== "running") throw new Error("Audio could not start. Try Start again.");
      this.startedAt = this.context.currentTime;
      this.nextTime = this.startedAt + 0.03;
      this.nextPosition = advance(this.position, this.settings.repeats, this.patternCount);
      this.playing = true;
      this.worker.postMessage("start");
      this.schedule();
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  pause() {
    ++this.generation;
    this.starting = false;
    if (this.playing) {
      this.update();
      this.elapsedBeforeStart = this.elapsed;
    }
    this.playing = false;
    this.worker.postMessage("stop");
    for (const oscillator of this.oscillators) {
      oscillator.stop(this.context.currentTime);
      oscillator.disconnect();
    }
    this.oscillators.clear();
    this.queue = [];
  }

  reset(pattern = 0) {
    this.pause();
    this.position = { pattern, repeat: 1, tick: -1 };
    this.elapsedBeforeStart = 0;
    this.onStep(this.position);
  }

  async selectPattern(pattern) {
    if (!Number.isInteger(pattern) || pattern < 0 || pattern >= this.patternCount) {
      throw new RangeError("Unknown pattern");
    }
    const wasPlaying = this.playing || this.starting;
    this.pause();
    this.position = { pattern, repeat: 1, tick: -1 };
    this.onStep(this.position);
    if (wasPlaying) await this.start();
  }

  schedule() {
    if (!this.playing) return;
    const now = this.context.currentTime;
    // A delayed timer must not replay a burst of clicks scheduled in the past.
    if (this.nextTime < now - 0.1) this.nextTime = now + 0.03;
    while (this.nextTime < now + 0.1) {
      const step = { ...this.nextPosition, time: this.nextTime };
      this.queue.push(step);
      if (step.tick % this.settings.subdivision === 0) this.click(step);
      this.nextTime += 60 / this.settings.tempo / 4;
      this.nextPosition = advance(step, this.settings.repeats, this.patternCount);
    }
  }

  click(step) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = step.tick % 16 === 0 ? 880 : step.tick % 4 === 0 ? 440 : 220;
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    gain.gain.setValueAtTime(0.001, step.time);
    gain.gain.linearRampToValueAtTime(0.15, step.time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, step.time + 0.04);
    oscillator.onended = () => {
      this.oscillators.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(step.time);
    oscillator.stop(step.time + 0.05);
    this.oscillators.add(oscillator);
  }

  update() {
    let current;
    while (this.queue.length && this.queue[0].time <= this.context.currentTime) {
      current = this.queue.shift();
    }
    if (current) {
      this.position = { pattern: current.pattern, repeat: current.repeat, tick: current.tick };
      this.onStep(this.position);
    }
  }
}
