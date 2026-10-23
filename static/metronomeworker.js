// Timer for the lookahead scheduler adapted from Chris Wilson's metronome.
// See licenses/metronome.txt for the original MIT license.
let timer;
self.onmessage = ({ data }) => {
  clearInterval(timer);
  timer = data === "start" ? setInterval(() => postMessage("tick"), 25) : undefined;
};
