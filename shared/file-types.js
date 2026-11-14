export function previewKind(mime) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime)
    ? "image"
    : ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"].includes(mime)
      ? "audio"
      : null;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
