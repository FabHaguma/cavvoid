// A native file picker can hide and refocus the page without navigating away.
// Revalidate on return without unmounting the composer or its file input.
export function watchAccessLifecycle({
  check,
  hide,
  offline,
  windowTarget = window,
  documentTarget = document,
}) {
  const resume = () => {
    if (documentTarget.visibilityState === "visible") check();
  };
  const listeners = [
    [windowTarget, "focus", check],
    [windowTarget, "pageshow", check],
    [windowTarget, "pagehide", hide],
    [windowTarget, "online", check],
    [windowTarget, "offline", offline],
    [documentTarget, "visibilitychange", resume],
  ];
  for (const [target, name, listener] of listeners)
    target.addEventListener(name, listener);
  return () => {
    for (const [target, name, listener] of listeners)
      target.removeEventListener(name, listener);
  };
}
