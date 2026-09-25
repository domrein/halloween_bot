export type QuickLine = { test: RegExp; say: string };

export type Character = {
  voice: string;
  voiceSpeed: number;
  voicePitch: number;
  voiceEchoMs: number;
  delays: string[];
  quickLines: QuickLine[];
  roleFile: string;
};

const hello = /^(?:hello|hi|hey)(?: there)?$/;
const trick = /^(?:trick|drink) or treat$/;
const howAreYou = /^how are you(?: doing)?$/;

export const characters = {
  ghost: {
    voice: "bm_george",
    voiceSpeed: 0.92,
    voicePitch: 0.78,
    voiceEchoMs: 120,
    delays: ["Well.", "Let me think.", "Hmmmmm."],
    quickLines: [
      { test: hello, say: "Hi there!" },
      { test: trick, say: "Happy Halloween!" },
      { test: howAreYou, say: "I'm hauntingly well!" },
    ],
    roleFile: "prompts/ghost.md",
  },
  scientist: {
    voice: "bm_fable",
    voiceSpeed: 0.86,
    voicePitch: 0.74,
    voiceEchoMs: 150,
    delays: ["Fascinating.", "Let me see.", "One moment."],
    quickLines: [
      { test: hello, say: "Good evening." },
      { test: trick, say: "A splendid Halloween to you." },
      { test: howAreYou, say: "My bones are in excellent condition." },
    ],
    roleFile: "prompts/scientist.md",
  },
  witch: {
    voice: "bf_emma",
    voiceSpeed: 0.9,
    voicePitch: 0.9,
    voiceEchoMs: 100,
    delays: ["Well, well.", "Let me stir.", "Hmmmmm."],
    quickLines: [
      { test: hello, say: "Hello, dear." },
      { test: trick, say: "Happy Halloween, dear." },
      { test: howAreYou, say: "Bubbling with trouble." },
    ],
    roleFile: "prompts/witch.md",
  },
} as const satisfies Record<string, Character>;

export type CharacterName = keyof typeof characters;

export function characterNames(): string[] {
  return Object.keys(characters);
}

export function getCharacter(name: string): Character {
  if (name in characters) return characters[name as CharacterName];
  throw new Error(`Unknown character "${name}". Choose one of: ${characterNames().join(", ")}`);
}
