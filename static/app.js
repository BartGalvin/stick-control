/*
Render sheet music staves
*/

// Initialize VexFlow for drawing music notation
VF = Vex.Flow;

// Create VexFlow SVG rendering context
function initContext(id, staveWidth) {
  var canvas = document.getElementById(id);
  var renderer = new VF.Renderer(canvas, 3);
  var renderWidth = staveWidth * 2.1;
  var renderHeight = 130;

  // Configure the rendering context based on stave dimensions
  renderer.resize(renderWidth, renderHeight);
  var context = renderer.getContext();
  context.setFont("Arial", 10, "").setBackgroundFillStyle("#eed");

  return context;
}

// Draw a stave in a new context (div) of a given ID
function drawStaves(id, staveWidth = 250) {
  staves = makeStaves(2, 2, staveWidth);
  notes = makeNotes();
  beams = makeBeams(notes);
  var context = initContext(id, staveWidth);

  for (let l = 0; l < staves.length; l++) {
    staves[l].setContext(context).draw();
    Vex.Flow.Formatter.FormatAndDraw(context, staves[l], notes);
    beams.forEach(function (b) {
      b.setContext(context).draw()
    });
  }
}

// Create an array of blank staves
function makeStaves(numStaves = 2, stavesPerLine = 2, staveWidth = 250) {
  var staves = [];

  // Set position of first stave and spacing
  var xPos = 10;
  var yPos = 40;
  var staveYspacing = 100;
  var colBuffer = 100;

  for (let j = 0; j < numStaves; j++) {
    stave = new VF.Stave(xPos, yPos, staveWidth);

    // Insert repeat end if at the end of a row
    if ((j + 1) % stavesPerLine == 0) {
      stave.setEndBarType(Vex.Flow.Barline.type.REPEAT_END);
      xPos -= staveWidth * (stavesPerLine - 1);
      yPos += staveYspacing;
    } else {
      // Insert repeat begin if at the start of a row
      if (j % stavesPerLine == 0) {
        stave.setBegBarType(Vex.Flow.Barline.type.REPEAT_BEGIN);
      }
      xPos += staveWidth;
    }
    staves.push(stave);
  }
  return staves;
}

// Create an array of notes to be placed on a stave
function makeNotes(numNotes = 8) {
  var notes = [];
  for (let k = 0; k < numNotes; k++) {
    notes.push(new VF.StaveNote({
      clef: "bass",
      keys: ["e/3"],
      duration: "8"
    }));
  }
  return notes;
}

// Create beams to connect notes in a given array
function makeBeams(notes) {
  beams = [];
  for (i = 0; i + 4 <= notes.length; i += 4) {
    beams.push(new VF.Beam(notes.slice(i, i + 4)));
  }
  return beams;
}

/*
Create a timer to track the length of practice
*/
var time = {
  "hours": 0,
  "minutes": 0,
  "seconds": 0
};
var timerTimeout;

function timer() {
  timerTimeout = setTimeout(timerCallback, 1000);
}

function timerCallback() {
  time.seconds += 1;
  if (time.seconds >= 60) {
    time.seconds = 0;
    time.minutes += 1;

    if (time.minutes >= 60) {
      time.minutes = 0;
      time.hours += 1;
    }
  }

  $("#time").text(
    (time.hours < 10 ? '0' : '') + time.hours + ":" +
    (time.minutes < 10 ? '0' : '') + time.minutes + ":" +
    (time.seconds < 10 ? '0' : '') + time.seconds);

  timer();
}

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

var audioContext = null;
var unlocked = false;
var isPlaying = false; // Are we currently playing?
var startTime; // The start time of the entire sequence.
var current16thNote; // What note is currently last scheduled?
var tempo = 60; // tempo (in beats per minute)
var repeat = 20; // number of repeats per pattern
var lookahead = 25.0; // How frequently to call scheduling function (in milliseconds)
var scheduleAheadTime = 0.1; // How far ahead to schedule audio (sec)
var nextNoteTime = 0.0; // when the next note is due.
var noteResolution = 0; // 0 == 16th, 1 == 8th, 2 == quarter note
var noteLength = 0.05; // length of "beep" (in seconds)
var last16thNoteDrawn = -1; // the last "box" we drew on the screen
var notesInQueue = []; // the notes that have been put into the web audio, and may or may not have played yet. {note, time}
var timerWorker = null; // The Web Worker used to fire timer messages
var currentStaveID = 0; // ID of div containing the current stave
var currentStave = null;
var currentNoteheads = null;
var loopsCounter = 1; // Counter for determining when to move to next stave

// First, shim the requestAnimationFrame API, with a setTimeout fallback
window.requestAnimFrame = (function () {
  return window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    function (callback) {
      window.setTimeout(callback, 1000 / 60);
    };
})();

// Advance current note and time by a 16th note
function nextNote() {
  var secondsPerBeat = 60.0 / tempo; // Notice this picks up the CURRENT
  // tempo value to calculate beat length.
  nextNoteTime += 0.25 * secondsPerBeat; // Add beat length to last beat time

  current16thNote++; // Advance the beat number, wrap to zero
  if (current16thNote == 16) {
    current16thNote = 0;
  }
}

// Push the note on the queue, even if we're not playing.
function scheduleNote(beatNumber, time) {
  notesInQueue.push({
    note: beatNumber,
    time: time
  });

  if ((noteResolution == 1) && (beatNumber % 2))
    return; // we're not playing non-8th 16th notes
  if ((noteResolution == 2) && (beatNumber % 4))
    return; // we're not playing non-quarter 8th notes

  // create an oscillator
  var osc = audioContext.createOscillator();
  osc.connect(audioContext.destination);
  if (beatNumber % 16 === 0) // beat 0 == high pitch
    osc.frequency.value = 880.0;
  else if (beatNumber % 4 === 0) // quarter notes = medium pitch
    osc.frequency.value = 440.0;
  else // other 16th notes = low pitch
    osc.frequency.value = 220.0;

  osc.start(time);
  osc.stop(time + noteLength);
}

function scheduler() {
  // while there are notes that will need to play before the next interval,
  // schedule them and advance the pointer.
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
    scheduleNote(current16thNote, nextNoteTime);
    nextNote();
  }
}

function play() {
  if (!unlocked) {
    // play silent buffer to unlock the audio
    var buffer = audioContext.createBuffer(1, 1, 22050);
    var node = audioContext.createBufferSource();
    node.buffer = buffer;
    node.start(0);
    unlocked = true;
  }

  isPlaying = !isPlaying;
  // Start playing
  if (isPlaying) {
    current16thNote = 0;
    loopsCounter = 1;
    nextNoteTime = audioContext.currentTime;
    timerWorker.postMessage("start");
    $("#" + currentStaveID).closest('.stave-row').addClass('active-row');
    $('html, body').animate({
      scrollTop: ($("#" + currentStaveID).offset().top - 200)
    }, 0);
    return "Stop";
  } else {
    stop();
    return "Start";
  }
}

function stop() {
  timerWorker.postMessage("stop");
  for (let i = 0; i < currentNoteheads.length; i++) {
    currentNoteheads[i].children[0].setAttribute("style", "fill: black");
  }
}

function reset() {
  if (isPlaying) {
    isPlaying = false;
    stop();
  }
  $("#play").addClass("btn-primary");
  $("#play").removeClass("btn-danger");
  $("#play").text("Start");
  $('#time').text("00:00:00");
  time = {
    "hours": 0,
    "minutes": 0,
    "seconds": 0
  };
  clearTimeout(timerTimeout);
  $("#reset").prop("disabled", true);
  loopsCounter = 1;
  $('#curRepeat').text(loopsCounter);
  $("#" + currentStaveID).closest('.stave-row').removeClass('active-row');
  currentStaveID = 0;
}

function colorNotes() {
  var currentNote = last16thNoteDrawn;
  var currentTime = audioContext.currentTime;
  var color = "black";

  while (notesInQueue.length && notesInQueue[0].time < currentTime) {
    currentNote = notesInQueue[0].note;
    notesInQueue.splice(0, 1); // remove note from queue
  }

  // We only need to draw if the note has moved.
  if (last16thNoteDrawn != currentNote) {
    // Check whether we need to move to the next stave
    if (last16thNoteDrawn == 15 && loopsCounter >= repeat) {
      currentNoteheads[last16thNoteDrawn].children[0].setAttribute("style", "fill: black");
      console.log(currentNote);
      nextStave();
    } else if (last16thNoteDrawn == 15) {
      loopsCounter += 1;
      $('#curRepeat').text(loopsCounter);
    }
    // Color the noteheads of the current stave
    currentStave = document.getElementById(currentStaveID);
    currentNoteheads = currentStave.getElementsByClassName("vf-notehead");
    for (var i = 0; i < 16; i++) {
      color = (currentNote == i) ?
        ((currentNote % 4 === 0) ? "red" : "blue") : "black";
      currentNoteheads[i].children[0].setAttribute("style", "fill:" + color);
    }
    last16thNoteDrawn = currentNote;
  }
  requestAnimFrame(colorNotes);
}

function nextStave() {
  $("#" + currentStaveID).closest('.stave-row').removeClass('active-row');
  currentStaveID = (currentStaveID + 1) % 24;
  $("#" + currentStaveID).closest('.stave-row').addClass('active-row');
  $('html, body').animate({
    scrollTop: ($("#" + currentStaveID).offset().top - 200)
  }, 0);
  $('#curRepeat').text(1);
  loopsCounter = 1;
}

function init() {
  fillCanvas();
  audioContext = new AudioContext();

  window.onresize = fillCanvas;

  requestAnimFrame(colorNotes); // start the note coloring loop.

  timerWorker = new Worker("../static/metronomeworker.js");

  timerWorker.onmessage = function (e) {
    if (e.data == "tick") {
      scheduler();
    } else
      console.log("message: " + e.data);
  };
  timerWorker.postMessage({
    "interval": lookahead
  });
}

function fillCanvas() {
  var colWidth = $(".col-md-6").width();

  for (let i = 0; i < 24; i++) {
    $("#" + i).empty();
    drawStaves(i, colWidth / 2 * .90);
  }
  var svgWidth = $("#0").children('svg').width();
  var noteheads = $("#0").find('.vf-stavenote').toArray();
  var dist = $(noteheads[8]).offset().left - $(noteheads[7]).offset().left;

  var fontspacing = svgWidth / 16 - 12;
  var buffer = dist - fontspacing - 8;

  $(".pattern").css("letter-spacing", fontspacing);
  $(".subpattern").css("margin-right", buffer);
}

$(window).on('load', function () {
  init();

  $("#play").click(function () {
    if (isPlaying) {
      $(this).addClass("btn-primary");
      $(this).removeClass("btn-danger");
      clearTimeout(timerTimeout);
    } else {
      $(this).addClass("btn-danger");
      $(this).removeClass("btn-primary");
      timer();
      $("#reset").prop("disabled", false);
    }

    this.innerText = play();
  });

  $("#reset").click(function () {
    reset();
  });

  $("#repeat").on('input', function () {
    repeat = event.target.value;
    $('#showRepeat').text(repeat);
    $('#numRepeats').text(repeat);
  });

  $("#tempo").on('input', function () {
    tempo = event.target.value;
    $('#showTempo').text(tempo);
  });

  $('input[type=radio][name=resOptions]').change(function () {
    noteResolution = this.value;
  });
});