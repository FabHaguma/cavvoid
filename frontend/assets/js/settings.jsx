import React, { useEffect, useRef, useState } from "react";
import { getStorage, getPreferences, updatePreferences } from "./api.js";
import { formatBytes } from "../../../shared/file-types.js";
import { RetentionSelect } from "./retention.jsx";
import { Icon } from "./icons.jsx";

export function StorageSettings({ refreshKey, onAccessError, onPreferences }) {
  const [storage, setStorage] = useState(null);
  const [preference, setPreference] = useState({ value: "24h", saved: "24h" });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const startedAt = revision.current;
    Promise.all([
      getStorage(controller.signal),
      getPreferences(controller.signal),
    ])
      .then(([usage, prefs]) => {
        if (controller.signal.aborted) return;
        setStorage(usage);
        if (startedAt === revision.current)
          setPreference((prev) => ({
            value:
              prev.value === prev.saved ? prefs.defaultExpiration : prev.value,
            saved: prefs.defaultExpiration,
          }));
        setLoaded(true);
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted && !onAccessError(err))
          setError(err.message);
      });
    return () => controller.abort();
  }, [refreshKey, reload, onAccessError]);
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    revision.current++;
    setNotice("");
    setError("");
    try {
      const result = await updatePreferences(preference.value);
      if (!mounted.current) return;
      setPreference({
        value: result.defaultExpiration,
        saved: result.defaultExpiration,
      });
      onPreferences(result);
      setNotice("Default saved. It applies to new drops on all your devices.");
    } catch (err) {
      if (mounted.current && !onAccessError(err)) setError(err.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <>
      <section
        className="settings-card storage-settings"
        aria-labelledby="storage-title"
      >
        <div className="setting-row">
          <h3 id="storage-title">
            <Icon name="file" size={20} /> Your storage
          </h3>
          <button
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            Refresh storage
          </button>
        </div>
        {!storage ? (
          <p role="status">Reading your storage…</p>
        ) : (
          <>
            <p className="storage-total">
              <strong>{formatBytes(storage.usedBytes)}</strong> of{" "}
              {formatBytes(storage.quotaBytes)} used
            </p>
            <progress
              className="storage-meter"
              aria-label="File storage used"
              value={storage.usedBytes}
              max={storage.quotaBytes}
            />
            <dl className="storage-counts">
              <div>
                <dt>Stored items</dt>
                <dd>{storage.counts.total}</dd>
              </div>
              <div>
                <dt>In Void</dt>
                <dd>{storage.counts.temporary}</dd>
              </div>
              <div>
                <dt>Kept</dt>
                <dd>{storage.counts.kept}</dd>
              </div>
            </dl>
            <p className="setting-note">
              Files: {formatBytes(storage.maxFileBytes)} each · Text:{" "}
              {formatBytes(storage.maxTextBytes)} per drop
            </p>
            <p className="setting-note">
              {formatBytes(storage.reservedBytes)} reserved for uploads ·{" "}
              {formatBytes(storage.pendingDeletionBytes)} awaiting deletion.
              Both count toward the quota. Item counts exclude expired drops.
            </p>
          </>
        )}
      </section>
      <section className="settings-card" aria-labelledby="defaults-title">
        <h3 id="defaults-title">Make this space yours</h3>
        <p>
          Choose how long new drops stay. You can change it for each drop.
          Existing drops keep their current expiration.
        </p>
        <form onSubmit={save}>
          <RetentionSelect
            id="default-expiration"
            label="Default expiration"
            value={preference.value}
            disabled={!loaded || saving}
            onChange={(value) => {
              setPreference((prev) => ({ ...prev, value }));
              setNotice("");
            }}
          />
          <button
            type="submit"
            className="button primary"
            disabled={
              !loaded || saving || preference.value === preference.saved
            }
          >
            {saving ? "Saving…" : "Save default"}
          </button>
        </form>
        {notice && (
          <p className="feed-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <div className="feed-error" role="alert">
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={() => setReload((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        )}
      </section>
    </>
  );
}
