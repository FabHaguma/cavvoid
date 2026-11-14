export function textBytes(text) {
  return new TextEncoder().encode(text).length;
}

export function safeLink(text) {
  const candidate = text.trim();
  if (!/^https?:\/\/[^\s<>"'`]+$/i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

// Plain string segments stay strings; callers render links with normal DOM/React APIs.
export function textParts(text, limit = Infinity) {
  const parts = [];
  const pattern = /https?:\/\/[^\s<>"'`]+/gi;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    const candidate = match[0].replace(/[.,!;:?)]+$/, "");
    const href = safeLink(candidate);
    if (!href) continue;
    parts.push({ text: text.slice(position, match.index) });
    parts.push({ text: candidate, href });
    position = match.index + candidate.length;
  }
  parts.push({ text: text.slice(position) });
  let remaining = limit;
  const visible = parts.flatMap((part) => {
    if (remaining <= 0) return [];
    const displayed = part.text.slice(0, remaining);
    remaining -= displayed.length;
    return [{ ...part, text: displayed }];
  });
  if (text.length > limit) visible.push({ text: "…" });
  return visible;
}
