export async function copyText(
  text,
  clipboard = globalThis.navigator?.clipboard,
) {
  if (!clipboard?.writeText)
    throw new Error(
      "Copy isn’t available in this browser. Select the text and copy it manually.",
    );
  try {
    await clipboard.writeText(text);
  } catch {
    throw new Error(
      "Clipboard access was denied. Select the text and copy it manually.",
    );
  }
}

function linkText(value) {
  return value.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).join("\n");
}

export function clipboardContent(data) {
  const files = Array.from(data?.files ?? []);
  if (!files.length) {
    for (const item of data?.items ?? []) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return {
    files,
    text: files.length ? "" : data?.getData("text/plain") || linkText(data?.getData("text/uri-list") ?? ""),
  };
}

async function readClipboardItems(clipboard) {
  const items = await clipboard.read();
  const images = items.flatMap((item) => {
    const type = item.types.find((type) => type.startsWith("image/"));
    return type ? [{ item, type }] : [];
  });
  if (images.length) {
    const files = await Promise.all(images.map(async ({ item, type }, index) => {
      const image = await item.getType(type);
      const extension = { "image/jpeg": "jpg", "image/svg+xml": "svg" }[type] ?? type.slice(6);
      const number = images.length > 1 ? `-${index + 1}` : "";
      return new File([image], `clipboard-image${number}.${extension}`, { type });
    }));
    return { files, text: "" };
  }
  for (const type of ["text/plain", "text/uri-list"]) {
    const item = items.find((candidate) => candidate.types.includes(type));
    if (!item) continue;
    const text = await (await item.getType(type)).text();
    if (text) return { files: [], text: type === "text/plain" ? text : linkText(text) };
  }
  return { files: [], text: "" };
}

export async function readClipboard(clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard?.read && !clipboard?.readText)
    throw new Error(
      "Open the text box and use Ctrl+V, Command+V, or your device’s Paste option.",
    );
  if (clipboard.read) {
    try {
      return await readClipboardItems(clipboard);
    } catch {
      // Some browsers support reading plain text even when rich reads fail.
    }
  }
  try {
    if (clipboard.readText) return { files: [], text: await clipboard.readText() };
  } catch {
    // Offer the native paste action when clipboard reads are denied.
  }
  throw new Error("Clipboard access was denied. Open the text box and paste directly.");
}
