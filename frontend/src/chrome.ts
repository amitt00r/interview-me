import { useSyncExternalStore } from 'react';

/**
 * Lets a page hide the app header (the interview room does while the whiteboard is open, to give the board the
 * whole window). A tiny external store rather than context, since only App reads it.
 */
let headerHidden = false;
const listeners = new Set<() => void>();

export function setHeaderHidden(hidden: boolean) {
  if (hidden === headerHidden) return;
  headerHidden = hidden;
  listeners.forEach((l) => l());
}

export const useHeaderHidden = () => useSyncExternalStore(
  (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  () => headerHidden,
);
