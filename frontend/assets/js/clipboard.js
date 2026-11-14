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

export async function pasteText(clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard?.readText)
    throw new Error(
      "Paste into the text box with Ctrl+V, Command+V, or your phone’s Paste option.",
    );
  try {
    return await clipboard.readText();
  } catch {
    throw new Error(
      "Clipboard access was denied. Paste directly into the text box instead.",
    );
  }
}
