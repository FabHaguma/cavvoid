import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.jsx";
import { uploadFile } from "./upload.js";
import { formatBytes } from "../../../shared/file-types.js";
import { KeepButton, RetentionStatus } from "./retention.jsx";
import { getItem } from "./api.js";

export function UploadPanel({
  initialFiles = [],
  maxFileBytes = 104857600,
  quotaBytes = 2147483648,
  onBusy,
  onSaved,
  onAccessError,
  onClose,
  retention = "24h",
}) {
  const [queue, setQueue] = useState(() =>
    Array.from(initialFiles).map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: file.size > maxFileBytes ? "too-large" : "queued",
      error:
        file.size > maxFileBytes
          ? `Larger than ${formatBytes(maxFileBytes)}.`
          : "",
    })),
  );
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const active = useRef(new Map()),
    inFlight = useRef(false),
    mounted = useRef(true),
    stop = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of active.current.values()) controller.abort();
      onBusy(false);
    };
  }, []);
  function add(files) {
    setQueue((previous) => [
      ...previous,
      ...Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: file.size > maxFileBytes ? "too-large" : "queued",
        error:
          file.size > maxFileBytes
            ? `Larger than ${formatBytes(maxFileBytes)}.`
            : "",
      })),
    ]);
    setNotice("");
  }
  const update = (id, patch) => {
    if (mounted.current)
      setQueue((previous) =>
        previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
  };
  async function send() {
    if (inFlight.current) return;
    const pending = queue.filter(
      (row) =>
        ["queued", "failed", "cancelled"].includes(row.status) &&
        row.file.size <= maxFileBytes,
    );
    if (!pending.length) return;
    inFlight.current = true;
    stop.current = false;
    setRunning(true);
    onBusy(true);
    setNotice("");
    let position = 0,
      saved = 0;
    let savedItem;
    async function worker() {
      while (position < pending.length && mounted.current && !stop.current) {
        const row = pending[position++],
          controller = new AbortController();
        active.current.set(row.id, controller);
        update(row.id, { status: "uploading", progress: 0, error: "" });
        try {
          // Freeze the first choice for a retry, including a lost success response.
          const choice = row.retention ?? retention;
          update(row.id, { retention: choice });
          const result = await uploadFile(row.file, row.id, {
            signal: controller.signal,
            retention: choice,
            onProgress: (progress) => update(row.id, { progress }),
          });
          update(row.id, { status: "uploaded", progress: 100 });
          saved++;
          savedItem = result.item;
        } catch (error) {
          if (onAccessError(error)) {
            stop.current = true;
            for (const request of active.current.values()) request.abort();
            break;
          }
          update(row.id, {
            status: error.status === 0 ? "cancelled" : "failed",
            error: error.message,
          });
        } finally {
          active.current.delete(row.id);
        }
      }
    }
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setRunning(false);
        onBusy(false);
        if (saved) {
          setNotice(
            `${saved} ${saved === 1 ? "file is" : "files are"} ready on your other devices.`,
          );
          onSaved(savedItem);
        }
      }
    }
  }
  const pending = queue.some(
    (row) =>
      ["queued", "failed", "cancelled"].includes(row.status) &&
      row.file.size <= maxFileBytes,
  );
  return (
    <div className="upload-panel">
      <div
        className={`file-dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          if (!running) add(event.dataTransfer.files);
        }}
      >
        <Icon name="file" size={34} />
        <strong>Give your files a place to land.</strong>
        <p>Drag files here, or choose from this device.</p>
        <label
          className={`button secondary file-picker ${running ? "disabled" : ""}`}
          htmlFor="file-picker"
        >
          Choose files
        </label>
        <input
          id="file-picker"
          className="visually-hidden"
          type="file"
          multiple
          disabled={running}
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
        />
        <span>
          Up to {formatBytes(maxFileBytes)} each · {formatBytes(quotaBytes)}{" "}
          storage limit
        </span>
      </div>
      {queue.length > 0 && (
        <ul className="upload-queue" aria-label="Files to upload">
          {queue.map((row) => (
            <li key={row.id}>
              <div className="upload-row">
                <Icon name="file" size={20} />
                <div className="upload-name">
                  <strong>{row.file.name}</strong>
                  <span>
                    {formatBytes(row.file.size)} ·{" "}
                    {row.status === "uploaded"
                      ? "Uploaded"
                      : row.status === "uploading"
                        ? row.progress >= 99
                          ? "Saving…"
                          : `Uploading ${row.progress}%`
                        : row.status === "queued"
                          ? "Ready to upload"
                          : row.status === "too-large"
                            ? "Too large"
                            : row.status === "cancelled"
                              ? "Cancelled"
                              : "Needs attention"}
                  </span>
                </div>
                {row.status === "uploading" ? (
                  <button
                    className="text-button"
                    onClick={() => active.current.get(row.id)?.abort()}
                  >
                    Cancel
                  </button>
                ) : (
                  !running &&
                  row.status !== "uploaded" && (
                    <button
                      className="icon-button"
                      aria-label={`Remove ${row.file.name}`}
                      onClick={() =>
                        setQueue((previous) =>
                          previous.filter((entry) => entry.id !== row.id),
                        )
                      }
                    >
                      <Icon name="close" size={18} />
                    </button>
                  )
                )}
              </div>
              <progress
                aria-label={`Upload progress for ${row.file.name}`}
                max={100}
                value={row.progress}
              />
              {row.error && (
                <p className="form-error" role="status">
                  {row.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="form-note" role="status">
          {notice}
        </p>
      )}
      <p className="upload-retention">
        <Icon name="lock" size={16} />
        Private. Each file uses your expiration choice when uploaded; retries
        keep the original choice.
      </p>
      <div className="detail-actions">
        {running ? (
          <button
            className="button secondary"
            onClick={() => {
              stop.current = true;
              for (const request of active.current.values()) request.abort();
            }}
          >
            Cancel uploads
          </button>
        ) : (
          <button className="button secondary" onClick={onClose}>
            Done
          </button>
        )}
        <button
          className="button primary"
          disabled={running || !pending}
          onClick={send}
        >
          {running
            ? "Uploading…"
            : queue.some(
                  (row) =>
                    row.status === "failed" || row.status === "cancelled",
                )
              ? "Upload / retry files"
              : "Upload files"}
          <Icon name="arrow" size={18} />
        </button>
      </div>
    </div>
  );
}

export function FileContent({
  item,
  expanded = false,
  onAccessError = () => false,
}) {
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function previewFailed() {
    setFailed(true);
    try {
      await getItem(item.id);
      if (mounted.current)
        setMessage(
          "This browser couldn’t preview this file. Retry or download it to open it.",
        );
    } catch (error) {
      if (mounted.current && !onAccessError(error)) setMessage(error.message);
    }
  }
  const source = `/api/items/${encodeURIComponent(item.id)}/preview`;
  return (
    <div className="file-content">
      <div className="file-title">
        <Icon name="file" size={24} />
        <div>
          <strong>{item.file.name}</strong>
          <span>
            {formatBytes(item.file.size)} ·{" "}
            {item.file.mimeType === "application/octet-stream"
              ? "File"
              : item.file.mimeType}
          </span>
        </div>
      </div>
      {item.file.previewKind === "image" && !failed && (
        <a
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View full image ${item.file.name}`}
        >
          <img
            key={attempt}
            className={expanded ? "file-preview expanded" : "file-preview"}
            src={source}
            loading="lazy"
            alt={item.file.name}
            onError={previewFailed}
          />
        </a>
      )}
      {item.file.previewKind === "audio" && !failed && (
        <audio
          key={attempt}
          controls
          preload="metadata"
          src={source}
          onError={previewFailed}
        >
          Download the file to play it.
        </audio>
      )}
      {(failed || !item.file.previewKind) && (
        <div className="file-fallback" role="status">
          <p>
            {failed
              ? message || "Checking this file…"
              : "Download to open this file safely on your device."}
          </p>
          {failed && (
            <button
              className="text-button"
              onClick={() => {
                setMessage("");
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            >
              Retry preview
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FileCard({
  item,
  busy,
  dateLabel,
  onDetails,
  onDelete,
  onKeep,
  onAccessError,
}) {
  return (
    <article className="item-card file-card" aria-label="File drop">
      <div className="item-card-heading">
        <span className="item-type">
          <Icon name="file" size={18} />
          {item.file.previewKind === "image"
            ? "Image"
            : item.file.previewKind === "audio"
              ? "Audio"
              : "File"}
        </span>
        <time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>
      </div>
      <FileContent item={item} onAccessError={onAccessError} />
      <RetentionStatus item={item} dateLabel={dateLabel} />
      <div className="item-actions">
        <a
          className="button secondary"
          href={`/api/items/${encodeURIComponent(item.id)}/download`}
          download={item.file.name}
        >
          Download
          <Icon name="arrow" size={16} />
        </a>
        <KeepButton item={item} busy={busy} onClick={onKeep} />
        <div className="item-utility">
          <button
            className="icon-button"
            aria-label="View file details"
            disabled={busy}
            onClick={onDetails}
          >
            <Icon name="info" size={19} />
          </button>
          <button
            className="icon-button delete-button"
            aria-label="Delete drop"
            disabled={busy}
            onClick={onDelete}
          >
            <Icon name="trash" size={19} />
          </button>
        </div>
      </div>
    </article>
  );
}
