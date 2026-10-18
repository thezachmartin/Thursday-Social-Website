const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const script = readFileSync(
  require.resolve("../background-video.js"),
  "utf8",
);

function setup({ reduced = false, blocked = false } = {}) {
  const video = Object.assign(new EventTarget(), {
    dataset: { src: "./assets/background.mp4" },
    paused: true,
    getAttribute() {
      return this.src;
    },
    async play() {
      if (blocked) {
        throw new DOMException("Autoplay blocked", "NotAllowedError");
      }
      this.paused = false;
      this.dispatchEvent(new Event("play"));
    },
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    },
  });
  const preference = Object.assign(new EventTarget(), { matches: reduced });
  const warnings = [];
  vm.runInNewContext(script, {
    document: {
      querySelector: () => video,
    },
    window: { matchMedia: () => preference },
    console: { warn: (...args) => warnings.push(args) },
  });
  return { video, preference, warnings };
}

test("loads and plays the background video", () => {
  const { video } = setup();
  assert.equal(video.src, "./assets/background.mp4");
  assert.equal(video.paused, false);
});

test("does not load video for reduced motion and responds to changes", () => {
  const { video, preference } = setup({ reduced: true });
  assert.equal(video.src, undefined);
  assert.equal(video.paused, true);
  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  assert.equal(video.paused, false);
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  assert.equal(video.paused, true);
});

test("blocked autoplay leaves the poster and reports the failure", async () => {
  const { video, warnings } = setup({ blocked: true });
  await new Promise(setImmediate);
  assert.equal(video.paused, true);
  assert.equal(warnings.length, 1);
});

test("media errors hide video to expose the poster fallback", () => {
  const { video, warnings } = setup();
  video.error = { code: 4 };
  video.dispatchEvent(new Event("error"));
  assert.equal(video.hidden, true);
  assert.equal(warnings.length, 1);
});
