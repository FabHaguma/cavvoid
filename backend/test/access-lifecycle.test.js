import test from "node:test";
import assert from "node:assert/strict";
import { watchAccessLifecycle } from "../../frontend/assets/js/access-lifecycle.js";

function fixture() {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  documentTarget.visibilityState = "visible";
  const calls = [];
  const stop = watchAccessLifecycle({
    windowTarget,
    documentTarget,
    check: () => calls.push("check"),
    hide: () => calls.push("hide"),
    offline: () => calls.push("offline"),
  });
  const visibility = (value) => {
    documentTarget.visibilityState = value;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
  };
  return { windowTarget, calls, stop, visibility };
}

test("returning from a phone file picker rechecks access without clearing the composer", () => {
  // Exercise both focus/visibility orders around selection or cancellation.
  for (const focusFirst of [false, true]) {
    const f = fixture();
    f.windowTarget.dispatchEvent(new Event("blur"));
    f.visibility("hidden");
    assert.deepEqual(f.calls, []);
    if (focusFirst) f.windowTarget.dispatchEvent(new Event("focus"));
    f.visibility("visible");
    if (!focusFirst) f.windowTarget.dispatchEvent(new Event("focus"));
    assert.deepEqual(f.calls, ["check", "check"]);
    f.stop();
  }
});

test("navigation and offline events still invoke the private-view clearing handlers", () => {
  const f = fixture();
  for (const type of ["pagehide", "pageshow", "offline", "online"])
    f.windowTarget.dispatchEvent(new Event(type));
  assert.deepEqual(f.calls, ["hide", "check", "offline", "check"]);
  f.stop();
});

test("cleanup detaches every lifecycle listener", () => {
  const f = fixture();
  f.stop();
  for (const type of ["focus", "pageshow", "pagehide", "online", "offline"])
    f.windowTarget.dispatchEvent(new Event(type));
  f.visibility("hidden");
  f.visibility("visible");
  assert.deepEqual(f.calls, []);
});
