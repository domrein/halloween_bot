/** The first finished sentence, or null while the model is still inside it. */
export function firstSentence(text: string): string | null {
  const cleaned = text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/^[^.!?]*[.!?]/);
  if (!match) return null;
  const sentence = match[0].trim();
  return sentence.length > 0 ? sentence : null;
}

/** A short opening the speaker can start while the rest of the line renders. */
export function firstSpokenChunk(text: string): { now: string; later: string } {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 5) return { now: trimmed, later: "" };
  const commaAt = trimmed.indexOf(",");
  if (commaAt > 0) {
    const left = trimmed.slice(0, commaAt).trim();
    const leftWords = left.split(/\s+/).filter(Boolean).length;
    if (leftWords >= 4 && leftWords <= 8) {
      return { now: `${left},`, later: trimmed.slice(commaAt + 1).trim() };
    }
  }
  return { now: words.slice(0, 5).join(" "), later: words.slice(5).join(" ") };
}

export function unfinishedLine(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
