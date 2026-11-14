import React from "react";
import { Icon } from "./icons.jsx";

export function PwaPanel({
  state,
  controller,
  compact = false,
  blocked = false,
}) {
  if (compact && !state.updateReady && !state.installable) return null;
  return (
    <section
      className={`pwa-panel ${compact ? "compact" : "settings-card"}`}
      aria-label="CavVoid app"
    >
      <div className="pwa-copy">
        {!compact && (
          <h3>
            <Icon name="devices" size={20} /> CavVoid on this device
          </h3>
        )}
        <p role="status">
          {state.updateReady
            ? "An update is ready. Close your composer before reloading."
            : state.installed
              ? "CavVoid is running as an app."
              : state.ready
                ? "The app can open offline. Reconnect to see your private drops."
                : state.message ||
                  (state.supported
                    ? state.preparing
                      ? "Preparing offline launch…"
                      : "Open CavVoid online to prepare offline launch."
                    : "Use CavVoid in your browser. Offline launch is unavailable here.")}
        </p>
        {!compact && !state.installed && (
          <p className="pwa-help">
            Install from your browser’s menu. On iPhone or iPad, open Safari →
            Share → Add to Home Screen. A connection is required to sign in,
            view drops, or upload.
          </p>
        )}
      </div>
      <div className="pwa-actions">
        {state.updateReady && (
          <button
            className="button secondary"
            disabled={blocked}
            onClick={() => controller.current?.update()}
          >
            Update & reload
          </button>
        )}
        {state.installable && !state.installed && (
          <button
            className="button secondary"
            onClick={() => controller.current?.install()}
          >
            Install app
            <Icon name="plus" size={17} />
          </button>
        )}
      </div>
    </section>
  );
}
