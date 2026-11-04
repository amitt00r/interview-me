import { useSyncExternalStore } from 'react';

/**
 * Nikolai's persona constants and a tiny store for hiding his button, e.g. in the interview room, which has its
 * own microphone and voice.
 */
export const NIKOLAI = {
  name: 'Nikolai',
} as const;

/**
 * Russian Azure voices reading English, for a natural Russian accent; picked in the chat header. Lev Flash is the
 * default: the clearest, and as quick to start as the standard voices (HD voices take ~0.5 s longer).
 */
export const NIKOLAI_VOICES = [
  { id: 'ru-RU-Lev:MAI-Voice-2.1-Flash', label: 'Lev', detail: 'Clear and quick (default)' },
  { id: 'ru-RU-Lev:MAI-Voice-2.1', label: 'Lev HD', detail: 'Richer, a little slower to start' },
  { id: 'ru-RU-DmitryNeural', label: 'Dmitry', detail: 'Classic, strongest accent' },
] as const;

const VOICE_KEY = 'nikolai-voice';
const voiceListeners = new Set<() => void>();

function storedVoice(): string {
  const saved = localStorage.getItem(VOICE_KEY);
  return NIKOLAI_VOICES.some((v) => v.id === saved) ? saved! : NIKOLAI_VOICES[0].id;
}

/** Nikolai's voice, chosen under Settings → Preferences and remembered in this browser. */
export function useNikolaiVoice(): string {
  return useSyncExternalStore(
    (l) => {
      voiceListeners.add(l);
      return () => voiceListeners.delete(l);
    },
    storedVoice,
  );
}

export function setNikolaiVoice(id: string) {
  localStorage.setItem(VOICE_KEY, id);
  voiceListeners.forEach((l) => l());
}

/**
 * Openers: each gives his name and asks what to do, in a different mood, without listing what he can do (the
 * system prompt keeps it that way in his replies too). One is picked at random, never the same twice in a row.
 */
const GREETINGS = [
  'Privet! I am Nikolai. What shall we work on today?',
  'Ah, there you are! Nikolai, at your service. Tell me, what do you need?',
  'Dobry den! My name is Nikolai. So, what are we doing today, my friend?',
  'Nikolai here. Nu, how can I help?',
  'Zdravstvuyte! I am Nikolai, your coach. Where do we begin?',
  'Hello, hello! Nikolai is listening. What is on your mind?',
  'Privet, my friend. It is Nikolai. What would you like me to do?',
  'Nikolai, reporting for duty! What is the plan today?',
  'Ah, a visitor! I am Nikolai. Davai, tell me what you need.',
  'Good to see you. I am Nikolai. How can I be useful today?',
  'Nikolai here, tea in hand and ready. What shall we do?',
  'Khorosho, you are back! Nikolai at your side. What is first?',
];

let lastGreeting = -1;

/** A random greeting, different from the previous one. */
export function nikolaiGreeting(): string {
  let i = Math.floor(Math.random() * GREETINGS.length);
  if (i === lastGreeting) i = (i + 1) % GREETINGS.length;
  lastGreeting = i;
  return GREETINGS[i];
}

let hiders = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Hides Nikolai while the returned function hasn't been called (use as a useEffect body). */
export function hideNikolai() {
  hiders++;
  emit();
  return () => {
    hiders--;
    emit();
  };
}

export function useNikolaiHidden() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hiders > 0,
  );
}
