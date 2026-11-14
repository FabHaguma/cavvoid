export function watchPwa({
  allowRegistration,
  onState,
  serviceWorker = globalThis.navigator?.serviceWorker,
  windowTarget = window,
  secure = globalThis.isSecureContext,
  standalone = () =>
    windowTarget.matchMedia?.("(display-mode: standalone)").matches ||
    windowTarget.navigator?.standalone === true,
}) {
  let active = true,
    registration,
    installPrompt,
    reloadRequested = false;
  let state = {
    supported: Boolean(serviceWorker && secure),
    ready: false,
    preparing: false,
    updateReady: false,
    installable: false,
    installed: Boolean(standalone()),
    message: "",
  };
  const listeners = [];
  const publish = (patch) => {
    state = { ...state, ...patch };
    if (active) onState(state);
  };
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  const refresh = () =>
    publish({
      ready: Boolean(registration?.active),
      updateReady: Boolean(registration?.waiting),
      preparing: Boolean(registration?.installing),
    });
  const attach = (value) => {
    if (!active || !value) return;
    registration = value;
    refresh();
    const track = (worker) => {
      if (!worker) return;
      listen(worker, "statechange", () => {
        refresh();
        if (worker.state === "redundant" && !value.active)
          publish({
            preparing: false,
            message:
              "Offline launch could not be prepared. Reopen CavVoid online to try again.",
          });
      });
    };
    track(value.installing);
    listen(value, "updatefound", () => {
      const worker = value.installing;
      track(worker);
      refresh();
    });
  };
  listen(windowTarget, "beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    publish({ installable: true });
  });
  listen(windowTarget, "appinstalled", () => {
    installPrompt = null;
    publish({ installed: true, installable: false });
  });
  if (state.supported) {
    listen(serviceWorker, "controllerchange", () => {
      refresh();
      if (reloadRequested) {
        reloadRequested = false;
        windowTarget.location.reload();
      }
    });
    const load = allowRegistration
      ? serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      : serviceWorker.getRegistration("/");
    Promise.resolve(load)
      .then(attach)
      .catch(() =>
        publish({
          message:
            "Offline launch is not ready yet. Open CavVoid online and try again.",
        }),
      );
    const update = () => {
      if (
        registration &&
        allowRegistration &&
        windowTarget.navigator?.onLine !== false
      )
        registration.update().catch(() => {});
    };
    listen(windowTarget, "focus", update);
  }
  publish({});
  return {
    async install() {
      if (!installPrompt) return;
      const prompt = installPrompt;
      installPrompt = null;
      publish({ installable: false });
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        publish({
          message:
            "Use your browser’s Install app or Add to Home Screen option.",
        });
      }
    },
    update() {
      if (!registration?.waiting) return;
      reloadRequested = true;
      registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    },
    stop() {
      active = false;
      for (const remove of listeners) remove();
      installPrompt = null;
    },
  };
}
