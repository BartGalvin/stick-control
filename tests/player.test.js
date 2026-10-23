import assert from "node:assert/strict";
import test from "node:test";
import { PracticePlayer } from "../static/player.js";
import { patterns } from "../static/patterns.js";

class AudioClock {
  currentTime = 0;
  state = "suspended";
  destination = {};
  tones = [];
  async resume() { this.state = "running"; }
  createOscillator() {
    const tone = {
      frequency: {}, connect() {}, disconnect() {},
      start(time) { this.startTime = time; },
      stop(time) { this.stopTime = time; },
    };
    this.tones.push(tone);
    return tone;
  }
  createGain() {
    return {
      connect() {}, disconnect() {},
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    };
  }
  moveTo(time) {
    this.currentTime = time;
    for (const tone of this.tones) {
      if (tone.stopTime <= time && !tone.ended) {
        tone.ended = true;
        tone.onended?.();
      }
    }
  }
}

function setup() {
  const context = new AudioClock();
  const messages = [];
  const steps = [];
  const worker = { postMessage: message => messages.push(message) };
  const player = new PracticePlayer({ context, worker, patternCount: patterns.length, onStep: step => steps.push({ ...step }) });
  function moveTo(time) {
    for (let next = context.currentTime + 0.025; next < time; next += 0.025) {
      context.moveTo(next);
      worker.onmessage();
      player.update();
    }
    context.moveTo(time);
    worker.onmessage();
    player.update();
  }
  return { context, worker, messages, steps, player, moveTo };
}

test("24 complete sticking patterns are available", () => {
  assert.equal(patterns.length, 24);
  assert.ok(patterns.every(pattern => /^[RL]{16}$/.test(pattern)));
});

test("no audio is scheduled until Start resumes the context", async () => {
  const { player, context, messages } = setup();
  assert.equal(context.tones.length, 0);
  await player.start();
  assert.equal(context.state, "running");
  assert.equal(player.playing, true);
  assert.deepEqual(messages, ["start"]);
  assert.equal(context.tones[0].startTime, 0.03);
});

test("16 eighth notes take eight quarter-note beats at the selected BPM", async () => {
  const { player, moveTo } = setup();
  player.setSettings({ repeats: 1 });
  await player.start();
  moveTo(7.79);
  assert.deepEqual(player.position, { pattern: 0, repeat: 1, tick: 31 });
  moveTo(8.04);
  assert.deepEqual(player.position, { pattern: 1, repeat: 1, tick: 0 });
});

test("repeat count changes patterns at the correct boundary", async () => {
  const { player, moveTo } = setup();
  player.setSettings({ tempo: 160, repeats: 2 });
  await player.start();
  moveTo(3.04);
  assert.deepEqual(player.position, { pattern: 0, repeat: 2, tick: 0 });
  moveTo(6.04);
  assert.deepEqual(player.position, { pattern: 1, repeat: 1, tick: 0 });
});

test("the last pattern wraps to the first", async () => {
  const { player, moveTo } = setup();
  player.setSettings({ tempo: 160, repeats: 1 });
  await player.selectPattern(23);
  await player.start();
  moveTo(3.04);
  assert.equal(player.position.pattern, 0);
});

test("sixteenth, eighth, and quarter clicks keep the same practice speed", async () => {
  for (const [subdivision, clicks] of [[1, 16], [2, 8], [4, 4]]) {
    const { player, context, moveTo } = setup();
    player.setSettings({ subdivision });
    await player.start();
    moveTo(3.94);
    const audible = context.tones.filter(tone => tone.startTime <= 3.94);
    assert.equal(audible.length, clicks);
    assert.equal(player.position.tick, 15);
  }
});

test("pause cancels queued clicks and excludes the pause from practice time", async () => {
  const { player, context, moveTo, messages } = setup();
  await player.start();
  moveTo(0.6);
  player.pause();
  const position = { ...player.position };
  assert.equal(player.queue.length, 0);
  assert.equal(player.oscillators.size, 0);
  assert.equal(messages.at(-1), "stop");
  context.moveTo(10);
  assert.equal(player.elapsed, 0.6);
  await player.start();
  moveTo(10.04);
  assert.equal(player.position.tick, position.tick + 1);
  assert.ok(Math.abs(player.elapsed - 0.64) < 0.00001);
});

test("reset clears the selection, counter, elapsed time, and pending work", async () => {
  const { player, moveTo } = setup();
  await player.selectPattern(5);
  await player.start();
  moveTo(1);
  player.reset();
  assert.deepEqual(player.position, { pattern: 0, repeat: 1, tick: -1 });
  assert.equal(player.elapsed, 0);
  assert.equal(player.playing, false);
  assert.equal(player.queue.length, 0);
});

test("rapid pause cancels a pending audio start", async () => {
  const { player, context, messages } = setup();
  let resume;
  context.resume = () => new Promise(resolve => { resume = resolve; });
  const started = player.start();
  player.pause();
  context.state = "running";
  resume();
  await started;
  assert.equal(player.playing, false);
  assert.equal(player.starting, false);
  assert.equal(context.tones.length, 0);
  assert.ok(!messages.includes("start"));
});

test("tempo changes affect the next unscheduled intervals", async () => {
  const { player, context, moveTo } = setup();
  await player.start();
  moveTo(0.3);
  player.setSettings({ tempo: 120 });
  moveTo(0.8);
  const times = context.tones.map(tone => tone.startTime);
  assert.ok(times.some((time, index) => index > 0 && Math.abs(time - times[index - 1] - 0.125) < 0.00001));
});

test("a delayed timer does not replay missed clicks in a burst", async () => {
  const { player, context, worker } = setup();
  await player.start();
  context.moveTo(20);
  const before = context.tones.length;
  worker.onmessage();
  assert.ok(context.tones.length - before <= 2);
  assert.ok(context.tones.slice(before).every(tone => tone.startTime > 20));
});

test("an immediate pause before the first click is safe", async () => {
  const { player, context } = setup();
  await player.start();
  player.pause();
  assert.equal(player.position.tick, -1);
  assert.ok(context.tones.every(tone => tone.stopTime === 0));
  await player.start();
  assert.equal(player.nextPosition.tick, 1);
});

test("selecting a pattern during playback cancels the old queue", async () => {
  const { player, moveTo } = setup();
  await player.start();
  moveTo(0.4);
  await player.selectPattern(7);
  assert.equal(player.playing, true);
  assert.ok(player.queue.every(step => step.pattern === 7));
  moveTo(0.44);
  assert.deepEqual(player.position, { pattern: 7, repeat: 1, tick: 0 });
});

test("invalid controls are rejected before changing settings", () => {
  const { player } = setup();
  for (const setting of [{ tempo: 0 }, { tempo: 161 }, { repeats: 0 }, { repeats: 41 }, { subdivision: 3 }]) {
    assert.throws(() => player.setSettings(setting), RangeError);
  }
  assert.deepEqual(player.settings, { tempo: 60, repeats: 20, subdivision: 1 });
});
