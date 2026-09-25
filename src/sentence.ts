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

export function unfinishedLine(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
