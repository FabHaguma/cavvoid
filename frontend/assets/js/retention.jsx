import React from "react";
import { retentionOptions } from "../../../shared/retention.js";
import { Icon } from "./icons.jsx";

export function RetentionSelect({
  id,
  value,
  onChange,
  disabled,
  editing = false,
  label,
}) {
  return (
    <div className="retention-field">
      <label htmlFor={id}>
        {label || (editing ? "Change expiration" : "Keep this for")}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {editing && <option value="">Choose a new duration…</option>}
        {retentionOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="retention-hint">
        {editing
          ? "A new duration starts when you apply it. Unkeep starts a fresh 24 hours."
          : value === "keep"
            ? "Stays in Kept until you remove it or change its expiration."
            : "The timer starts when your drop is saved."}
      </span>
    </div>
  );
}

export function RetentionStatus({ item, dateLabel }) {
  return (
    <div className={`item-expiration ${item.isKept ? "kept-status" : ""}`}>
      <Icon name={item.isKept ? "kept" : "clock"} size={15} />
      <span>
        {item.isKept
          ? "Kept · no expiration"
          : `Expires ${dateLabel(item.expiresAt)}`}
      </span>
    </div>
  );
}

export function KeepButton({ item, busy, onClick }) {
  return (
    <button
      className={`button secondary ${item.isKept ? "is-kept-button" : ""}`}
      disabled={busy}
      onClick={onClick}
      title={
        item.isKept
          ? "Return to Void for a fresh 24 hours"
          : "Keep without expiration"
      }
    >
      <Icon name="kept" size={16} />
      {item.isKept ? "Unkeep" : "Keep"}
    </button>
  );
}
