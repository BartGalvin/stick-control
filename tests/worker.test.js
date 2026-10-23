import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("starting twice creates one timer, and stopping clears it", () => {
  const timers = new Map();
  let id = 0;
  const scope = {
    self: {},
    setInterval(callback) { timers.set(++id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
    postMessage() {},
  };
  vm.runInNewContext(readFileSync(new URL("../static/metronomeworker.js", import.meta.url), "utf8"), scope);
  scope.self.onmessage({ data: "start" });
  scope.self.onmessage({ data: "start" });
  assert.equal(timers.size, 1);
  scope.self.onmessage({ data: "stop" });
  assert.equal(timers.size, 0);
});
