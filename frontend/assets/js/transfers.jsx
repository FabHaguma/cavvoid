import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons.jsx";
import {
  deleteItem,
  getItem,
  getItems,
  saveText,
  updateRetention,
} from "./api.js";
import { clipboardContent, copyText, readClipboard } from "./clipboard.js";
import { safeLink, textBytes, textParts } from "../../../shared/text.js";
import { FileCard, FileContent, UploadPanel } from "./file-transfers.jsx";
import { KeepButton, RetentionSelect, RetentionStatus } from "./retention.jsx";
import { isAvailable } from "../../../shared/retention.js";
import {
  typeOptions,
  sectionOptions,
  sortOptions,
} from "../../../shared/search.js";

const dateLabel = (value) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

function Modal({
  open,
  onClose,
  titleId,
  children,
  className = "",
  busy = false,
  returnFocus,
  onPaste,
  onDragOver,
  onDrop,
}) {
  const ref = useRef();
  const opener = useRef();
  useEffect(() => {
    if (open && !ref.current.open) {
      opener.current = returnFocus?.current || document.activeElement;
      ref.current.showModal();
    } else if (!open && ref.current.open) {
      ref.current.close();
      (opener.current?.isConnected && opener.current !== document.body
        ? opener.current
        : document.getElementById("main")
      )?.focus({ preventScroll: true });
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`drop-dialog ${className}`}
      aria-labelledby={titleId}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-toolbar">
        <button
          className="icon-button dialog-close"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function DropDialog({
  open,
  onClose,
  maxBytes = 102400,
  onSaved,
  onAccessError,
  fileLimits = {},
  initialFiles = [],
  initialText = "",
  autoUpload = false,
  defaultExpiration = "24h",
}) {
  const [mode, setMode] = useState("text");
  const [retention, setRetention] = useState("24h");
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [pasting, setPasting] = useState(false);
  const input = useRef();
  const pasteButton = useRef();
  const uploads = useRef();
  const clipboardRequest = useRef();
  const submission = useRef("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (open) {
      setMode(initialFiles.length ? "files" : "text");
      setRetention(defaultExpiration);
      setText(initialText);
      setError("");
      setNotice("");
      setPasting(false);
      submission.current = crypto.randomUUID();
    }
    return () => {
      clipboardRequest.current = null;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      (mode === "text" ? input.current : pasteButton.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, mode]);
  const bytes = textBytes(text);
  const change = (value) => {
    setText(value);
    setError("");
    submission.current = crypto.randomUUID();
  };
  function uploadFiles(files) {
    setNotice("");
    setMode("files");
    uploads.current?.upload(files);
  }
  function useClipboardContent({ files, text: value }) {
    if (files.length) {
      uploadFiles(files);
    } else if (value) {
      change(value);
      setMode("text");
      input.current?.focus();
    } else {
      setNotice("The clipboard has no image, text, or link to paste.");
    }
  }
  function onPaste(event) {
    const content = clipboardContent(event.clipboardData);
    if (saving || (!content.files.length && !content.text)) return;
    clipboardRequest.current = null;
    setPasting(false);
    setNotice("");
    if (
      !content.files.length &&
      event.target === input.current &&
      event.clipboardData.getData("text/plain")
    ) return;
    event.preventDefault();
    useClipboardContent(content);
  }
  async function paste() {
    const request = {};
    clipboardRequest.current = request;
    setPasting(true);
    setNotice("");
    try {
      const content = await readClipboard();
      if (clipboardRequest.current === request) useClipboardContent(content);
    } catch (err) {
      if (clipboardRequest.current === request) setNotice(err.message);
    } finally {
      if (clipboardRequest.current === request) {
        clipboardRequest.current = null;
        setPasting(false);
      }
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || uploading || pasting || !text.trim() || bytes > maxBytes) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveText(text, submission.current, retention);
      onSaved(result.item);
      if (uploads.current?.hasPending()) {
        setText("");
        setMode("files");
        submission.current = crypto.randomUUID();
      } else onClose();
    } catch (err) {
      if (!onAccessError(err)) setError(err.message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      titleId="drop-title"
      className="composer-dialog"
      busy={saving || uploading}
      onPaste={onPaste}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (!saving) uploadFiles(files);
      }}
    >
      <span className="eyebrow">OUT OF THIS DEVICE. INTO YOUR VOID.</span>
      <h2 id="drop-title">Drop something.</h2>
      <p>Drop files here or paste an image, text, or link.</p>
      {!autoUpload && (initialText || initialFiles.length > 0) && (
        <p className="form-note" role="status">
          Ready to send. Review your content and expiration first.
          {initialText &&
            initialFiles.length > 0 &&
            " Send the text and files from their separate tabs."}
        </p>
      )}
      <div className="drop-type-switch" role="group" aria-label="Drop type">
        <button
          className={mode === "text" ? "active" : ""}
          aria-pressed={mode === "text"}
          disabled={saving}
          onClick={() => setMode("text")}
        >
          <Icon name="text" size={18} />
          Text & links
        </button>
        <button
          className={mode === "files" ? "active" : ""}
          data-mode="files"
          aria-pressed={mode === "files"}
          disabled={saving}
          onClick={() => setMode("files")}
        >
          <Icon name="file" size={18} />
          Files & media
        </button>
      </div>
      <RetentionSelect
        id="drop-retention"
        value={retention}
        disabled={saving || uploading}
        onChange={(value) => {
          setRetention(value);
          submission.current = crypto.randomUUID();
        }}
      />
      <div className="composer-label">
        {mode === "text" && <label htmlFor="drop-text">Text or link</label>}
        <button
          ref={pasteButton}
          type="button"
          className="text-button"
          disabled={saving || pasting}
          onClick={paste}
        >
          <Icon name="copy" size={16} />
          {pasting ? "Reading clipboard…" : "Paste"}
        </button>
      </div>
      {notice && (
        <p className="form-note" role="status">
          {notice}
        </p>
      )}
      <div hidden={mode !== "files"}>
        {open && (
          <UploadPanel
            ref={uploads}
            initialFiles={initialFiles}
            autoUpload={autoUpload}
            initialRetention={defaultExpiration}
            maxFileBytes={fileLimits.maxFileBytes}
            quotaBytes={fileLimits.storageQuotaBytes}
            onBusy={setUploading}
            onSaved={onSaved}
            onAccessError={onAccessError}
            onClose={onClose}
            retention={retention}
          />
        )}
      </div>
      {mode === "text" && (
        <>
          <form onSubmit={submit}>
            <textarea
              id="drop-text"
              ref={input}
              value={text}
              onChange={(event) => change(event.target.value)}
              placeholder="Something to take with you…"
              rows={8}
              disabled={saving}
              aria-describedby="drop-limit"
              aria-invalid={bytes > maxBytes || undefined}
            />
            <div className="composer-meta">
              <span>
                <Icon name="clock" size={16} />
                {retention === "keep"
                  ? "No automatic expiration"
                  : "Expires automatically"}
              </span>
              <span
                id="drop-limit"
                className={bytes > maxBytes ? "limit-exceeded" : ""}
              >
                {(bytes / 1024).toFixed(1)} /{" "}
                {(maxBytes / 1024).toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}{" "}
                KB
              </span>
            </div>
            {bytes > maxBytes && (
              <p className="form-error" role="alert">
                This drop is too long. Shorten it to fit the text limit.
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="composer-footer">
              <span>
                <Icon name="lock" size={15} />
                Only you can see this.
              </span>
              <button
                className="button primary"
                disabled={saving || uploading || pasting || !text.trim() || bytes > maxBytes}
                type="submit"
              >
                {saving ? "Dropping…" : "Drop into Void"}
                <Icon name="arrow" size={18} />
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}

function TextContent({ text, url }) {
  if (url)
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {text.length > 650 ? text.slice(0, 650) + "…" : text}
      </a>
    );
  return textParts(text, 650).map((part, index) =>
    part.href ? (
      <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
        {part.text}
      </a>
    ) : (
      <React.Fragment key={index}>{part.text}</React.Fragment>
    ),
  );
}

export function TransferFeed({ section, refreshKey, onAccessError, children }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    q: "",
    type: "all",
    section,
    sort: "newest",
  });
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [detail, setDetail] = useState(null);
  const [manualCopy, setManualCopy] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [retention, setRetention] = useState("");
  const [retentionError, setRetentionError] = useState("");
  const detailInput = useRef();
  const detailTrigger = useRef();
  const sequence = useRef(0);
  const offset = useRef(0);
  const mounted = useRef(true);
  const refreshController = useRef();
  const detailRef = useRef();
  const deleteRef = useRef();
  detailRef.current = detail;
  deleteRef.current = toDelete;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
      refreshController.current?.abort();
    };
  }, []);
  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await getItems(filters.section, page, controller.signal, {
        q: filters.q,
        type: filters.type,
        sort: filters.sort,
      });
      if (!mounted.current || current !== sequence.current) return;
      if (!Array.isArray(result.items))
        throw new Error("We couldn’t read your drops. Please try again.");
      offset.current = Date.parse(result.serverTime) - Date.now();
      if (!result.items.length && page > 1) {
        setPage(Math.max(1, result.totalPages));
        return;
      }
      setData(result);
      // A detail can belong to a different section after Keep/unkeep. Read it
      // directly rather than assuming an absent feed card means deletion.
      const ids = [
        ...new Set(
          [detailRef.current?.id, deleteRef.current?.id].filter(Boolean),
        ),
      ];
      await Promise.all(
        ids.map(async (id) => {
          try {
            const latest = await getItem(id, controller.signal);
            if (!mounted.current || current !== sequence.current) return;
            setDetail((previous) =>
              previous?.id === id ? latest.item : previous,
            );
            setToDelete((previous) =>
              previous?.id === id ? latest.item : previous,
            );
          } catch (err) {
            if (
              !mounted.current ||
              current !== sequence.current ||
              err.name === "AbortError"
            )
              return;
            if ([404, 410].includes(err.status)) {
              setDetail((previous) => (previous?.id === id ? null : previous));
              setToDelete((previous) =>
                previous?.id === id ? null : previous,
              );
            } else if (!onAccessError(err)) setNotice(err.message);
          }
        }),
      );
    } catch (err) {
      if (
        mounted.current &&
        current === sequence.current &&
        err.name !== "AbortError" &&
        !onAccessError(err)
      )
        setError(err.message);
    } finally {
      if (mounted.current && current === sequence.current) setLoading(false);
    }
  }, [filters, page, onAccessError]);
  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);
  useEffect(() => {
    setRetention("");
    setRetentionError("");
  }, [detail?.id, detail?.updatedAt]);
  useEffect(() => {
    const deadlines = [...(data?.items || []), detail, toDelete]
      .filter(Boolean)
      .filter((item) => !item.isKept && item.expiresAt)
      .map((item) => Date.parse(item.expiresAt));
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => {
        const now = Date.now() + offset.current;
        setData((previous) => {
          if (!previous) return previous;
          const items = previous.items.filter((item) => isAvailable(item, now));
          return {
            ...previous,
            items,
            total: Math.max(
              0,
              previous.total - (previous.items.length - items.length),
            ),
          };
        });
        setDetail((previous) =>
          previous && !isAvailable(previous, now) ? null : previous,
        );
        setToDelete((previous) =>
          previous && !isAvailable(previous, now) ? null : previous,
        );
        refresh();
      },
      Math.max(10, Math.min(...deadlines) - (Date.now() + offset.current) + 10),
    );
    return () => clearTimeout(timer);
  }, [data, detail, toDelete, refresh]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [refresh]);
  async function changeRetention(item, choice) {
    if (busy) return;
    setBusy(item.id);
    setRetentionError("");
    setNotice("");
    try {
      const result = await updateRetention(item.id, choice);
      if (!mounted.current) return;
      setDetail((previous) =>
        previous?.id === item.id ? result.item : previous,
      );
      setNotice(
        result.item.isKept
          ? "Kept. Find it in Kept, with no expiration."
          : item.isKept
            ? "Returned to Void with a fresh expiration."
            : "Expiration updated.",
      );
      // Update visible state immediately, even if the following refresh fails.
      setData((previous) => {
        if (!previous) return previous;
        const moved =
          filters.section !== "all" &&
          result.item.isKept !== (filters.section === "kept");
        return {
          ...previous,
          items: previous.items.flatMap((row) =>
            row.id === item.id ? (moved ? [] : [result.item]) : [row],
          ),
          total: Math.max(
            0,
            previous.total -
              Number(moved && previous.items.some((row) => row.id === item.id)),
          ),
        };
      });
      await refresh();
    } catch (err) {
      if (!onAccessError(err)) {
        setNotice(err.message);
        setRetentionError(err.message);
        if ([404, 410].includes(err.status)) {
          setDetail(null);
          refresh();
        }
      }
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function perform(item, action) {
    if (busy) return;
    // Remember the trigger before disabling it during the async access check.
    detailTrigger.current = document.activeElement;
    setBusy(item.id);
    setNotice("");
    try {
      const result = await getItem(item.id);
      if (!mounted.current) return;
      if (action === "copy") {
        try {
          await copyText(result.item.text);
          setNotice("Copied. Ready for wherever you need it.");
        } catch (err) {
          setManualCopy(true);
          setCopyMessage(err.message);
          setDetail(result.item);
        }
      } else {
        setManualCopy(false);
        setCopyMessage("");
        setDetail(result.item);
      }
    } catch (err) {
      if (!onAccessError(err)) {
        setNotice(err.message);
        if ([404, 410].includes(err.status)) refresh();
      }
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function remove() {
    if (busy || !toDelete) return;
    setBusy(toDelete.id);
    setError("");
    try {
      await deleteItem(toDelete.id);
      const removed = toDelete.id;
      setData((previous) =>
        previous
          ? {
              ...previous,
              items: previous.items.filter((item) => item.id !== removed),
              total: Math.max(0, previous.total - 1),
            }
          : previous,
      );
      setDetail((previous) => (previous?.id === removed ? null : previous));
      setToDelete(null);
      setNotice("Drop deleted from all your devices.");
      await refresh();
    } catch (err) {
      setToDelete(null);
      if (!onAccessError(err)) {
        setError(err.message);
        if ([404, 410].includes(err.status)) refresh();
      }
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  const cards = data?.items || [];
  const filtered = Boolean(
    filters.q || filters.type !== "all" || filters.section !== section,
  );
  function changeFilters(patch) {
    setFilters((previous) => ({ ...previous, ...patch }));
    setPage(1);
    setData(null);
    setNotice("");
  }
  function clearFilters() {
    setSearch("");
    changeFilters({ q: "", type: "all", section, sort: "newest" });
  }
  return (
    <>
      <form
        className="search-tools"
        role="search"
        aria-label="Search drops"
        onSubmit={(event) => {
          event.preventDefault();
          changeFilters({ q: search.trim() });
        }}
      >
        <div className="search-field">
          <label htmlFor="drop-search">Find a drop</label>
          <div className="search-input-row">
            <input
              id="drop-search"
              type="search"
              maxLength={200}
              value={search}
              placeholder="Search text or filenames…"
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="button secondary" type="submit">
              Search
            </button>
          </div>
        </div>
        <div className="search-filters">
          {[
            ["section", "Look in", sectionOptions],
            ["type", "Content type", typeOptions],
            ["sort", "Sort", sortOptions],
          ].map(([key, label, options]) => (
            <div key={key}>
              <label htmlFor={`filter-${key}`}>{label}</label>
              <select
                id={`filter-${key}`}
                value={filters[key]}
                onChange={(event) =>
                  changeFilters({ [key]: event.target.value })
                }
              >
                {options.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button type="button" className="text-button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </form>
      <div className="feed-heading">
        <span role="status">
          {filtered
            ? "MATCHING DROPS"
            : section === "kept"
              ? "KEPT ITEMS"
              : "RECENT DROPS"}
          <span className="item-count">{data?.total ?? "…"}</span>
        </span>
        <button
          className="text-button refresh-button"
          onClick={refresh}
          disabled={loading || Boolean(busy)}
        >
          <Icon name="refresh" size={16} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {notice && (
        <p className="feed-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="feed-error" role="alert">
          <p>{error}</p>
          <button className="button secondary" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {loading && !data ? (
        <div className="feed-loading" role="status">
          Gathering your drops…
        </div>
      ) : !error && !cards.length ? (
        filtered ? (
          <section className="search-empty" role="status">
            <h2>No matching drops.</h2>
            <p>Try another word, filename, or content type.</p>
            <button className="button secondary" onClick={clearFilters}>
              Clear filters
            </button>
          </section>
        ) : (
          children
        )
      ) : (
        <div className="item-grid" aria-label="Saved drops">
          {cards.map((item) => {
            if (item.type === "file")
              return (
                <FileCard
                  key={item.id}
                  item={item}
                  busy={Boolean(busy)}
                  dateLabel={dateLabel}
                  onDetails={() => perform(item, "details")}
                  onDelete={() => setToDelete(item)}
                  onKeep={() =>
                    changeRetention(item, item.isKept ? "24h" : "keep")
                  }
                  onAccessError={onAccessError}
                />
              );
            return (
              <article
                className={item.type === "link" ? "item-card link-card" : "item-card"}
                key={item.id}
                aria-label={`${item.type === "link" ? "Link" : "Text"} drop`}
              >
                <div className="item-card-heading">
                  <span className="item-type">
                    <Icon
                      name={item.type === "link" ? "link" : "text"}
                      size={18}
                    />
                    {item.type === "link" ? "Link" : "Text"}
                  </span>
                  <time dateTime={item.createdAt}>
                    {dateLabel(item.createdAt)}
                  </time>
                </div>
                <p className="item-text">
                  <TextContent
                    text={item.text}
                    url={item.type === "link" ? safeLink(item.text) : null}
                  />
                </p>
                {item.text.length > 650 && (
                  <button
                    className="text-button expand-button"
                    onClick={() => perform(item, "details")}
                    disabled={Boolean(busy)}
                  >
                    Read full text
                    <Icon name="arrow" size={16} />
                  </button>
                )}
                <RetentionStatus item={item} dateLabel={dateLabel} />
                <div className="item-actions">
                  <button
                    className="button secondary"
                    onClick={() => perform(item, "copy")}
                    disabled={Boolean(busy)}
                  >
                    <Icon name="copy" size={16} />
                    {busy === item.id ? "One moment…" : "Copy"}
                  </button>
                  <KeepButton
                    item={item}
                    busy={Boolean(busy)}
                    onClick={() =>
                      changeRetention(item, item.isKept ? "24h" : "keep")
                    }
                  />
                  {item.type === "link" && safeLink(item.text) && (
                    <a
                      className="button secondary"
                      href={safeLink(item.text)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open
                      <Icon name="arrow" size={16} />
                    </a>
                  )}
                  <div className="item-utility">
                    <button
                      className="icon-button"
                      aria-label="View drop details"
                      onClick={() => perform(item, "details")}
                      disabled={Boolean(busy)}
                    >
                      <Icon name="info" size={19} />
                    </button>
                    <button
                      className="icon-button delete-button"
                      aria-label="Delete drop"
                      disabled={Boolean(busy)}
                      onClick={() => setToDelete(item)}
                    >
                      <Icon name="trash" size={19} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {data && data.totalPages > 1 && (
        <nav className="pagination" aria-label="Drop pages">
          <button
            className="button secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {data.totalPages}
          </span>
          <button
            className="button secondary"
            disabled={page >= data.totalPages || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </nav>
      )}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        titleId="details-title"
        returnFocus={detailTrigger}
        className="detail-dialog"
        busy={Boolean(busy)}
      >
        <span className="eyebrow">
          {manualCopy ? "A SIMPLE WAY TO COPY" : "YOUR DROP, IN FULL"}
        </span>
        <h2 id="details-title">
          {manualCopy ? "Copy it your way." : "Drop details"}
        </h2>
        {copyMessage && (
          <p className="form-note" role="status">
            {copyMessage}
          </p>
        )}
        {detail?.type === "file" ? (
          <>
            <FileContent item={detail} expanded onAccessError={onAccessError} />
            <div className="detail-meta">
              <span>Created {dateLabel(detail.createdAt)}</span>
              <span>
                {detail.isKept
                  ? "Kept · no expiration"
                  : `Expires ${dateLabel(detail.expiresAt)}`}
              </span>
            </div>
            <div className="detail-actions">
              <a
                className="button secondary"
                href={`/api/items/${encodeURIComponent(detail.id)}/download`}
                download={detail.file.name}
              >
                Download
                <Icon name="arrow" size={16} />
              </a>
              <button
                className="button primary"
                onClick={() => setDetail(null)}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="detail-label" htmlFor="full-drop-text">
              Full drop text
            </label>
            <textarea
              id="full-drop-text"
              ref={detailInput}
              value={detail?.text || ""}
              readOnly
              rows={10}
            />
            <div className="detail-meta">
              <span>Created {detail && dateLabel(detail.createdAt)}</span>
              <span>
                {detail?.isKept
                  ? "Kept · no expiration"
                  : detail && `Expires ${dateLabel(detail.expiresAt)}`}
              </span>
              <span>
                {detail ? textBytes(detail.text).toLocaleString() : 0} bytes ·{" "}
                {detail?.type === "link" ? "Link" : "Plain text"}
              </span>
            </div>
            <div className="detail-actions">
              <button
                className="button secondary"
                onClick={() => {
                  detailInput.current.focus();
                  detailInput.current.select();
                  setCopyMessage(
                    "Text selected. Use Ctrl+C, Command+C, or your phone’s Copy option.",
                  );
                }}
              >
                Select text
              </button>
              <button
                className="button primary"
                onClick={() => setDetail(null)}
              >
                Done
              </button>
            </div>
          </>
        )}
        {detail && (
          <div className="detail-retention">
            <RetentionSelect
              id="edit-retention"
              value={retention}
              onChange={setRetention}
              disabled={Boolean(busy)}
              editing
            />
            {retentionError && (
              <p className="form-error" role="alert">
                {retentionError}
              </p>
            )}
            <div className="detail-actions">
              <KeepButton
                item={detail}
                busy={Boolean(busy)}
                onClick={() =>
                  changeRetention(detail, detail.isKept ? "24h" : "keep")
                }
              />
              <button
                className="button primary"
                disabled={!retention || Boolean(busy)}
                onClick={() => changeRetention(detail, retention)}
              >
                {busy ? "Applying…" : "Apply expiration"}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        titleId="delete-title"
        busy={Boolean(busy)}
      >
        <span className="eyebrow">LET IT GO</span>
        <h2 id="delete-title">Delete this drop?</h2>
        <p>
          This removes it from your Void on all your devices. You can’t undo
          this.
        </p>
        <div className="detail-actions">
          <button
            className="button secondary"
            disabled={Boolean(busy)}
            onClick={() => setToDelete(null)}
          >
            Cancel
          </button>
          <button
            className="button danger"
            disabled={Boolean(busy)}
            onClick={remove}
          >
            {busy ? "Deleting…" : "Delete drop"}
          </button>
        </div>
      </Modal>
    </>
  );
}
