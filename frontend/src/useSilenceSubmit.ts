import { useCallback, useEffect, useRef, useState } from 'react';

/** Interview room: submit after this much silence, showing a countdown once silent for `warningMs`. */
export const ROOM_SILENCE = { submitMs: 10_000, warningMs: 5_000 } as const;

export interface SilenceTiming {
  /** Silence before what was said is submitted. */
  submitMs: number;
  /** Silence before the countdown appears. */
  warningMs: number;
}

/**
 * Hands-free submit for dictation: while `active`, submits after `timing.submitMs` without speech, as long as
 * `canSubmit()` (there is something to send); with nothing to send it just keeps listening. Call `heard()` from
 * the recogniser's callbacks whenever speech arrives. `remainingMs` is set once silent for `timing.warningMs`, so the
 * UI can show a countdown, and null otherwise.
 */
export function useSilenceSubmit(active: boolean, canSubmit: () => boolean, submit: () => void,
  timing: SilenceTiming = ROOM_SILENCE) {
  const { submitMs, warningMs } = timing;
  const lastSpeech = useRef(Date.now());
  const canSubmitRef = useRef(canSubmit);
  const submitRef = useRef(submit);
  canSubmitRef.current = canSubmit;
  submitRef.current = submit;
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    setRemainingMs(null);
    if (!active) return;
    lastSpeech.current = Date.now();
    const timer = setInterval(() => {
      if (!canSubmitRef.current()) {
        // Nothing to send yet: keep listening, and start the silence clock over.
        lastSpeech.current = Date.now();
        setRemainingMs(null);
        return;
      }
      const silent = Date.now() - lastSpeech.current;
      if (silent >= submitMs) {
        setRemainingMs(null);
        lastSpeech.current = Date.now();
        submitRef.current();
      } else {
        setRemainingMs(silent >= warningMs ? submitMs - silent : null);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [active, submitMs, warningMs]);

  const heard = useCallback(() => {
    lastSpeech.current = Date.now();
    setRemainingMs(null);
  }, []);

  return { heard, remainingMs };
}
