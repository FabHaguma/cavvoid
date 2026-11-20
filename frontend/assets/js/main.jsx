import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AccessError, getAccess, getPreferences } from "./api.js";
import { StorageSettings } from "./settings.jsx";
import { DropDialog, TransferFeed } from "./transfers.jsx";
import { clipboardContent } from "./clipboard.js";
import { startLiveSync } from "./live-sync.js";
import { watchAccessLifecycle } from "./access-lifecycle.js";
import { watchPwa } from "./pwa.js";
import { PwaPanel } from "./pwa.jsx";
import { expireShares, receiveShare } from "./share-target.js";
import "../css/styles.css";
import logo from "../images/cavvoid.svg";

import { Icon } from "./icons.jsx";

function VoidIllustration({ kept = false }) {
  return (
    <div
      className={`void-illustration ${kept ? "is-kept" : ""}`}
      aria-hidden="true"
    >
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orbit orbit-three" />
      <span className="star star-one" />
      <span className="star star-two" />
      <span className="star star-three" />
      <span className="floating-symbol symbol-text">
        <Icon name="text" size={22} />
      </span>
      <span className="floating-symbol symbol-file">
        <Icon name={kept ? "kept" : "file"} size={22} />
      </span>
      <div className="void-core">
        <span />
      </div>
    </div>
  );
}

function Settings({
  access,
  leave,
  pwa,
  pwaController,
  refreshKey,
  onAccessError,
  onPreferences,
}) {
  return (
    <div className="settings-content">
      <section className="settings-card account-card">
        <div className="card-icon">
          <Icon name="shield" size={26} />
        </div>
        <div>
          <span className="eyebrow">ONE SIGN-IN. YOUR DEVICES.</span>
          <h2>Welcome, {access.owner.displayName}.</h2>
          <p>
            Your space is protected by Gatekeeper. Manage your signed-in devices
            and account in one place.
          </p>
        </div>
      </section>
      <PwaPanel state={pwa} controller={pwaController} />
      <section className="settings-card">
        <div className="setting-row">
          <div className="setting-label">
            <Icon name="devices" />
            <div>
              <h3>Devices & sign-in</h3>
              <p>Review your sessions or sign out a device.</p>
            </div>
          </div>
          <button className="button secondary" onClick={leave}>
            Manage sign-in
            <Icon name="arrow" size={18} />
          </button>
        </div>
        <p className="setting-note">
          <Icon name="lock" size={17} />
          Sign-out also applies to other apps using the same Gatekeeper session.
          To sign out everywhere, end other sessions first, then your current
          one.
        </p>
      </section>
      <StorageSettings
        refreshKey={refreshKey}
        onAccessError={onAccessError}
        onPreferences={onPreferences}
      />
    </div>
  );
}

function AccessState({ error, retry, pwa, pwaController }) {
  const offline = ["offline", "network_unavailable"].includes(error?.code);
  const signInUrl =
    error?.signInUrl ||
    ([401, 403].includes(error?.status) ? window.location.href : null);
  return (
    <main className="access-screen">
      <img src={logo} alt="" width="48" height="48" />
      <span className="wordmark">CavVoid</span>
      <h1>
        {offline
          ? "Your Void is offline."
          : error
            ? error.status === 401
              ? "Your space is waiting."
              : "A moment of quiet."
            : "Opening your space…"}
      </h1>
      <p role={error ? "alert" : "status"}>
        {offline
          ? "Reconnect to open your private space. Your drops stay on the server; files won’t upload while you’re offline."
          : error?.message || "Checking your private connection."}
      </p>
      {error && (
        <div className="access-actions">
          <button className="button primary" onClick={retry}>
            {offline ? "Reconnect" : "Try again"}
          </button>
          {signInUrl && (
            <a className="button secondary" href={signInUrl}>
              Sign in
              <Icon name="arrow" size={18} />
            </a>
          )}
        </div>
      )}
      {offline && (
        <p className="offline-note">
          <Icon name="lock" size={17} />
          No private drops are stored for offline access.
        </p>
      )}
      <PwaPanel state={pwa} controller={pwaController} compact />
    </main>
  );
}

function App() {
  const [access, setAccess] = useState(null);
  const [preferences, setPreferences] = useState({ defaultExpiration: "24h" });
  const [error, setError] = useState(null);
  const [drop, setDrop] = useState(null);
  const dropOpen = Boolean(drop);
  const openDrop = () => setDrop({});
  const [retryKey, setRetryKey] = useState(0);
  const [feedVersion, setFeedVersion] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [syncStatus, setSyncStatus] = useState("connecting");
  const live = useRef(null);
  const [pwa, setPwa] = useState({ supported: true, ready: false });
  const pwaController = useRef(null);
  const accessEpoch = useRef(0);
  const incomingRead = useRef(null);
  const incomingHandled = useRef(false);
  const handleApiError = useCallback((err) => {
    if (![401, 403].includes(err.status)) return false;
    accessEpoch.current++;
    live.current?.stop();
    setAccess(null);
    incomingRead.current = null;
    setDrop(null);
    setError(err);
    return true;
  }, []);
  const section =
    window.location.pathname === "/settings"
      ? "settings"
      : window.location.pathname === "/kept"
        ? "kept"
        : "void";
  const hasAccess = Boolean(access);
  useEffect(() => {
    if (!hasAccess || dropOpen) return;
    function onPaste(event) {
      const target = event.target;
      if (
        event.defaultPrevented ||
        target.isContentEditable ||
        target.closest?.("input, textarea, dialog")
      ) return;
      const content = clipboardContent(event.clipboardData);
      if (!content.files.length && !content.text) return;
      event.preventDefault();
      setDrop({ ...content, autoUpload: true });
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [hasAccess, dropOpen]);
  useEffect(() => {
    expireShares().catch(() => {});
  }, []);
  useEffect(() => {
    if (!hasAccess || incomingHandled.current) return;
    let active = true;
    const epoch = accessEpoch.current;
    incomingRead.current ||= receiveShare(window.location.href);
    incomingRead.current.then((draft) => {
      if (!active || epoch !== accessEpoch.current) return;
      incomingHandled.current = true;
      incomingRead.current = null;
      if (!draft) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      url.searchParams.delete("share-error");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
      if (draft.message) setFeedback(draft.message);
      else setDrop({ text: draft.text, files: draft.files });
    });
    return () => {
      active = false;
    };
  }, [hasAccess]);
  useEffect(() => {
    if (!hasAccess) return;
    const controller = new AbortController();
    getPreferences(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setPreferences(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) handleApiError(err);
      });
    return () => controller.abort();
  }, [hasAccess, feedVersion, handleApiError]);
  useEffect(() => {
    const controller = watchPwa({
      allowRegistration: hasAccess,
      onState: setPwa,
    });
    pwaController.current = controller;
    return () => controller.stop();
  }, [hasAccess]);
  useEffect(() => {
    if (!hasAccess) return;
    const connection = startLiveSync({
      onStatus: setSyncStatus,
      onChange: () => setFeedVersion((value) => value + 1),
      onDenied: handleApiError,
    });
    live.current = connection;
    return () => {
      connection.stop();
      if (live.current === connection) live.current = null;
    };
  }, [hasAccess, handleApiError]);
  useEffect(() => {
    let controller;
    let active = true;
    let retryTimer;
    let failures = 0;
    async function check() {
      controller?.abort();
      clearTimeout(retryTimer);
      const request = new AbortController();
      controller = request;
      const epoch = accessEpoch.current;
      try {
        if (navigator.onLine === false)
          throw new AccessError(0, "You’re offline.", undefined, "offline");
        const result = await getAccess(request.signal);
        if (active && !request.signal.aborted && epoch === accessEpoch.current) {
          setAccess(result);
          setPreferences(result.preferences || { defaultExpiration: "24h" });
          setError(null);
          failures = 0;
          setFeedVersion((value) => value + 1);
        }
      } catch (err) {
        if (
          active &&
          !request.signal.aborted &&
          epoch === accessEpoch.current &&
          err.name !== "AbortError"
        ) {
          setAccess(null);
          incomingRead.current = null;
          setDrop(null);
          setError(err);
          if (
            ["network_unavailable", "gateway_unavailable"].includes(err.code) &&
            navigator.onLine !== false
          )
            retryTimer = setTimeout(
              check,
              Math.min(30000, 5000 * 2 ** Math.min(failures++, 3)),
            );
        }
      }
    }
    const hide = () => {
      controller?.abort();
      clearTimeout(retryTimer);
      accessEpoch.current++;
      live.current?.stop();
      flushSync(() => {
        setAccess(null);
        incomingRead.current = null;
        setDrop(null);
      });
    };
    const offline = () => {
      controller?.abort();
      clearTimeout(retryTimer);
      hide();
      setError(new AccessError(0, "You’re offline.", undefined, "offline"));
    };
    check();
    const stopWatching = watchAccessLifecycle({ check, hide, offline });
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(retryTimer);
      stopWatching();
    };
  }, [retryKey]);
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame;
    const size = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        `${viewport?.height || window.innerHeight}px`,
      );
      cancelAnimationFrame(frame);
      const focused = document.activeElement;
      if (
        focused?.matches("input, textarea, select") &&
        focused.closest("dialog[open]")
      )
        frame = requestAnimationFrame(() => {
          if (focused.isConnected && document.activeElement === focused)
            focused.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
    };
    size();
    viewport?.addEventListener("resize", size);
    window.addEventListener("resize", size);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", size);
      window.removeEventListener("resize", size);
    };
  }, []);
  const leave = () => {
    const url = access.authentication.managementUrl;
    live.current?.stop();
    accessEpoch.current++;
    flushSync(() => {
      setAccess(null);
      incomingRead.current = null;
      setDrop(null);
    });
    window.location.assign(url);
  };
  if (!access)
    return (
      <AccessState
        error={error}
        pwa={pwa}
        pwaController={pwaController}
        retry={() => {
          setError(null);
          setRetryKey((value) => value + 1);
        }}
      />
    );
  const destinations = [
    { id: "void", label: "Void", url: "/", icon: "void" },
    { id: "kept", label: "Kept", url: "/kept", icon: "kept" },
    { id: "settings", label: "Settings", url: "/settings", icon: "settings" },
  ];
  const title =
    section === "settings"
      ? "Your space, your way."
      : section === "kept"
        ? "Worth keeping."
        : "Your Void";
  const subtitle =
    section === "settings"
      ? "A few things that keep everything yours."
      : section === "kept"
        ? "A home for the things you want to hold on to."
        : "A little space between all your devices.";
  return (
    <div
      className="app-shell"
      data-section={section}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          if (!dropOpen && !event.target.closest?.("dialog")) {
            setDrop({ files: Array.from(event.dataTransfer.files), autoUpload: true });
          }
        }
      }}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="CavVoid home">
          <img src={logo} alt="" width="42" height="42" />
          <div>
            <span className="wordmark">CavVoid</span>
            <span className="brand-subtitle">Drop it in. Pull it out.</span>
          </div>
        </a>
        <div className="nav-caption">YOUR SPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {destinations.map((item) => (
            <a
              key={item.id}
              href={item.url}
              className={section === item.id ? "nav-link active" : "nav-link"}
              aria-current={section === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {section === item.id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <div className="private-symbol">
              <Icon name="lock" size={20} />
            </div>
            <h2>Just for you.</h2>
            <p>A private pocket for the things moving between your devices.</p>
          </div>
          <button className="profile-button" onClick={leave}>
            <span className="avatar">
              {Array.from(access.owner.displayName)[0]?.toUpperCase()}
            </span>
            <span>
              <strong>{access.owner.displayName}</strong>
              <small>Manage sign-in</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span className="breadcrumb">
            Your private space<span>/</span>
            <strong>
              {section === "void"
                ? "Void"
                : section === "kept"
                  ? "Kept"
                  : "Settings"}
            </strong>
          </span>
          <span className="protected-status">
            <span />
            Protected by Gatekeeper
          </span>
          <a className="mobile-brand" href="/" aria-label="CavVoid home">
            <img src={logo} width="32" height="32" alt="" />
            <span>CavVoid</span>
          </a>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {section === "settings"
                  ? "PERSONAL & PRIVATE"
                  : section === "kept"
                    ? "A LITTLE MORE PERMANENT"
                    : "OUT OF ONE DEVICE. INTO ANOTHER."}
              </span>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            {section !== "settings" && (
              <button
                className="button primary heading-drop"
                onClick={openDrop}
              >
                <Icon name="plus" size={20} />
                New drop
              </button>
            )}
          </div>
          {section === "settings" ? (
            <Settings
              access={access}
              leave={leave}
              pwa={pwa}
              pwaController={pwaController}
              refreshKey={feedVersion}
              onAccessError={handleApiError}
              onPreferences={setPreferences}
            />
          ) : (
            <>
              <PwaPanel
                state={pwa}
                controller={pwaController}
                compact
                blocked={dropOpen}
              />
              <div className={`sync-status ${syncStatus}`} role="status">
                <span className="sync-dot" />
                <span>
                  {syncStatus === "live"
                    ? "Live updates are on"
                    : syncStatus === "offline"
                      ? "Offline. Reconnect to update your drops."
                      : syncStatus === "unsupported"
                        ? "Automatic updates unavailable. Use Refresh."
                        : syncStatus === "connecting"
                          ? "Connecting live updates…"
                          : "Reconnecting… Your drops will catch up automatically."}
                </span>
                {["reconnecting", "unsupported"].includes(syncStatus) && (
                  <button
                    className="text-button"
                    onClick={() => live.current?.reconnect()}
                  >
                    Reconnect
                  </button>
                )}
              </div>
              {feedback && (
                <p className="feed-notice" role="status">
                  {feedback}
                </p>
              )}
              <TransferFeed
                key={section}
                refreshKey={feedVersion}
                section={section}
                onAccessError={handleApiError}
              >
                <section className="empty-space" aria-labelledby="empty-title">
                  <VoidIllustration kept={section === "kept"} />
                  <span className="empty-kicker">
                    {section === "kept"
                      ? "GOOD THINGS DESERVE A PLACE"
                      : "NOTHING LOST. NOTHING IN THE WAY."}
                  </span>
                  <h2 id="empty-title">
                    {section === "kept"
                      ? "Nothing kept. Yet."
                      : "Your Void is beautifully empty."}
                  </h2>
                  <p>
                    {section === "kept"
                      ? "Keep the things you want to come back to.\nThey’ll stay right here, until you say otherwise."
                      : "Text, links, files. A thought from your phone.\nSomething for later on your laptop. It all belongs here."}
                  </p>
                  <button
                    className="button primary empty-drop"
                    onClick={openDrop}
                  >
                    <Icon name="plus" size={20} />
                    {section === "kept"
                      ? "Make a new drop"
                      : "Make your first drop"}
                  </button>
                  <div className="content-types">
                    <span>
                      <Icon name="text" size={17} />
                      Text & links
                    </span>
                    <span className="type-separator" />
                    <span>
                      <Icon name="file" size={17} />
                      Files & media
                    </span>
                  </div>
                </section>
              </TransferFeed>
              <div className="bottom-note">
                <Icon name="devices" size={18} />
                <span>One private space. Wherever you pick things up.</span>
                <span className="local-badge">Local preview</span>
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>CavVoid</span>
          <span>Less sending to yourself. More getting on with it.</span>
          <Icon name="lock" size={15} />
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {destinations.map((item) => (
          <a
            key={item.id}
            href={item.url}
            aria-current={section === item.id ? "page" : undefined}
            className={section === item.id ? "active" : ""}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <DropDialog
        open={dropOpen}
        defaultExpiration={preferences.defaultExpiration}
        onClose={() => setDrop(null)}
        maxBytes={access.limits?.maxTextBytes}
        fileLimits={access.limits}
        initialFiles={drop?.files}
        initialText={drop?.text}
        autoUpload={drop?.autoUpload}
        onAccessError={handleApiError}
        onSaved={(item) => {
          setFeedVersion((value) => value + 1);
          setFeedback(
            item?.isKept
              ? "Kept. Find your drop in Kept, with no expiration."
              : "Dropped. Find it in Void, ready to pick up on your other device.",
          );
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
