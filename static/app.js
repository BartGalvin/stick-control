import { patterns } from "./patterns.js";
import { PracticePlayer } from "./player.js";

const VF = window.Vex.Flow;
const playButton = document.querySelector("#play");
const resetButton = document.querySelector("#reset");
const tempo = document.querySelector("#tempo");
const repeats = document.querySelector("#repeats");
const subdivision = document.querySelector("#subdivision");
const progress = document.querySelector("#progress");
const elapsed = document.querySelector("#time");
const error = document.querySelector("#error");
const score = document.querySelector("#patterns");
let player;
let selectedPattern = 0;
let highlightedNote;
let animation;

const cards = patterns.map((pattern, index) => {
  const card = document.createElement("article");
  card.className = "pattern";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pattern-button";
  button.textContent = `Pattern ${index + 1}`;
  button.setAttribute("aria-label", `Practice pattern ${index + 1}: ${pattern.split("").join(" ")}`);
  button.addEventListener("click", () => selectPattern(index));
  const notation = document.createElement("div");
  notation.className = "notation";
  notation.setAttribute("aria-hidden", "true");
  card.append(button, notation);
  score.append(card);
  return { card, button, notation };
});

function drawScore() {
  for (const [index, { notation }] of cards.entries()) {
    notation.replaceChildren();
    const width = notation.clientWidth;
    const stacked = width < 420;
    const renderer = new VF.Renderer(notation, VF.Renderer.Backends.SVG);
    renderer.resize(width, stacked ? 218 : 118);
    const context = renderer.getContext();
    const barWidth = stacked ? width - 20 : (width - 20) / 2;
    for (let bar = 0; bar < 2; bar++) {
      const x = stacked ? 10 : 10 + bar * barWidth;
      const y = stacked ? bar * 100 : 0;
      const stave = new VF.Stave(x, y, barWidth);
      if (bar === 0) stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
      if (bar === 1) stave.setEndBarType(VF.Barline.type.REPEAT_END);
      stave.setContext(context).draw();
      const notes = [...patterns[index].slice(bar * 8, bar * 8 + 8)].map(hand => {
        const annotation = new VF.Annotation(hand).setFont("Arial", 12, "bold")
          .setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM);
        return new VF.StaveNote({ clef: "bass", keys: ["e/3"], duration: "8" })
          .addAnnotation(0, annotation);
      });
      const beams = [new VF.Beam(notes.slice(0, 4)), new VF.Beam(notes.slice(4))];
      VF.Formatter.FormatAndDraw(context, stave, notes);
      beams.forEach(beam => beam.setContext(context).draw());
    }
  }
  highlightedNote = undefined;
  renderPosition(player?.position ?? { pattern: selectedPattern, repeat: 1, tick: -1 });
}

function renderPosition(position) {
  const changedPattern = selectedPattern !== position.pattern;
  selectedPattern = position.pattern;
  for (const [index, { card, button }] of cards.entries()) {
    card.classList.toggle("is-selected", index === selectedPattern);
    button.setAttribute("aria-pressed", String(index === selectedPattern));
  }
  highlightedNote?.classList.remove("current-note");
  highlightedNote = position.tick < 0 ? undefined : cards[selectedPattern].notation
    .querySelectorAll(".vf-notehead")[Math.floor(position.tick / 2)];
  highlightedNote?.classList.add("current-note");
  const label = `Pattern ${selectedPattern + 1} / Repeat ${position.repeat} of ${repeats.value}`;
  if (progress.textContent !== label) progress.textContent = label;
  if (changedPattern && player?.playing) cards[selectedPattern].card.scrollIntoView({ block: "nearest" });
}

function settings() {
  return { tempo: tempo.valueAsNumber, repeats: repeats.valueAsNumber, subdivision: Number(subdivision.value) };
}

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

function ensurePlayer() {
  if (player) return player;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error("Audio is not supported in this browser. Try a current browser.");
  const context = new AudioContext();
  const worker = new Worker(new URL("./metronomeworker.js", import.meta.url));
  player = new PracticePlayer({ context, worker, patternCount: patterns.length, pattern: selectedPattern, onStep: renderPosition });
  worker.onerror = () => {
    player.pause();
    renderTransport();
    showError("Playback stopped. Reload the page to try again.");
  };
  player.setSettings(settings());
  return player;
}

function renderTransport() {
  const label = player?.starting ? "Cancel" : player?.playing ? "Pause"
    : player?.elapsed > 0 ? "Resume" : "Start";
  if (playButton.textContent !== label) playButton.textContent = label;
  resetButton.disabled = !player?.playing && !player?.starting
    && !(player?.elapsed > 0) && selectedPattern === 0 && !(player?.position.tick >= 0);
  const seconds = Math.floor(player?.elapsed ?? 0);
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
  if (elapsed.textContent !== time) elapsed.textContent = time;
}

function animate() {
  player.update();
  renderTransport();
  animation = player.playing ? requestAnimationFrame(animate) : undefined;
}

function startAnimation() {
  if (animation === undefined && player?.playing) animation = requestAnimationFrame(animate);
}

function pause() {
  player?.pause();
  cancelAnimationFrame(animation);
  animation = undefined;
  renderTransport();
}

playButton.addEventListener("click", async () => {
  showError("");
  try {
    const practice = ensurePlayer();
    if (practice.playing || practice.starting) {
      pause();
    } else {
      const started = practice.start();
      renderTransport();
      await started;
      renderTransport();
      startAnimation();
    }
  } catch (failure) {
    pause();
    showError(failure.message || "Audio could not start. Try Start again.");
  }
});

async function selectPattern(index) {
  showError("");
  try {
    if (player) await player.selectPattern(index);
    else renderPosition({ pattern: index, repeat: 1, tick: -1 });
    renderTransport();
    startAnimation();
  } catch (failure) {
    pause();
    showError(failure.message || "Audio could not start. Try Start again.");
  }
}

resetButton.addEventListener("click", () => {
  pause();
  player?.reset();
  renderPosition({ pattern: 0, repeat: 1, tick: -1 });
  renderTransport();
  showError("");
});

for (const input of [tempo, repeats, subdivision]) {
  input.addEventListener("input", () => {
    document.querySelector("#tempo-value").textContent = `${tempo.value} BPM`;
    document.querySelector("#repeats-value").textContent = repeats.value;
    player?.setSettings(settings());
    renderPosition(player?.position ?? { pattern: selectedPattern, repeat: 1, tick: -1 });
  });
}

document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("pagehide", pause);
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawScore, 100);
});
new ResizeObserver(entries => {
  document.documentElement.style.setProperty("--controls-height", `${entries[0].target.offsetHeight}px`);
}).observe(document.querySelector(".controls"));

drawScore();
renderTransport();
