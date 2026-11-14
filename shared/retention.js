export const retentionOptions = [
  { value: "10m", label: "10 minutes", milliseconds: 600000 },
  { value: "1h", label: "1 hour", milliseconds: 3600000 },
  { value: "24h", label: "24 hours", milliseconds: 86400000 },
  { value: "7d", label: "7 days", milliseconds: 604800000 },
  { value: "keep", label: "Keep · no expiration", milliseconds: null },
];

export function retentionPolicy(value = "24h", now) {
  const option = retentionOptions.find((entry) => entry.value === value);
  if (!option) return null;
  return {
    isKept: value === "keep",
    expiresAt:
      value === "keep"
        ? null
        : new Date(now + option.milliseconds).toISOString(),
  };
}

export const isAvailable = (item, now) =>
  item.isKept || (item.expiresAt && Date.parse(item.expiresAt) > now);
