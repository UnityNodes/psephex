const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/gu;

/**
 * Questions are arbitrary on-chain text. Control, zero-width and bidi characters could reorder
 * what a reader sees, so they are shown as a visible replacement character instead.
 */
export function displayText(text: string): string {
  return text.replace(/\r\n|\n/g, " ").replace(HIDDEN_CHARS, "\uFFFD");
}
