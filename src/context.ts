export type ContextKind = "seen" | "heard" | "said";

type ContextEvent = {
  kind: ContextKind;
  text: string;
};

const MAX_EVENTS = 50;

export class ContextLog {
  private events: ContextEvent[] = [];

  add(kind: ContextKind, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.events.push({ kind, text: trimmed });
    while (this.events.length > MAX_EVENTS) this.events.shift();
  }

  prompt(): string {
    if (this.events.length === 0) return "nothing yet";
    return this.events.map((event) => `${event.kind}: ${event.text}`).join("\n");
  }

  get size(): number {
    return this.events.length;
  }
}
