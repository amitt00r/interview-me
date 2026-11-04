import { useSyncExternalStore } from 'react';

/**
 * Small per-browser preferences (Settings → Preferences), kept in localStorage. Each has a fixed set of allowed
 * values, so a stale or hand-edited value falls back to the default.
 */
interface Pref<T extends number> {
  key: string;
  options: readonly T[];
  fallback: T;
}

/** Seconds of silence before Nikolai's chat sends what you said (hands-free). */
export const CHAT_PAUSE: Pref<number> = { key: 'pref-chat-pause', options: [2, 3, 5, 8, 10], fallback: 5 };
/** Default pause preselected in the start-interview dialog (each interview can still choose its own). */
export const INTERVIEW_PAUSE: Pref<number> = {
  key: 'pref-interview-pause', options: [3, 5, 10, 15, 20, 30], fallback: 10,
};

const listeners = new Set<() => void>();

function read<T extends number>(pref: Pref<T>): T {
  const raw = Number(localStorage.getItem(pref.key));
  return pref.options.includes(raw as T) ? (raw as T) : pref.fallback;
}

export function usePref<T extends number>(pref: Pref<T>): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => read(pref),
  );
}

export function setPref<T extends number>(pref: Pref<T>, value: T) {
  localStorage.setItem(pref.key, String(value));
  listeners.forEach((l) => l());
}
