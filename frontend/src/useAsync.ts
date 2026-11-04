import { useCallback, useEffect, useState } from 'react';

/** Window event fired after data changes outside the current page (e.g. by Nikolai); every useAsync reloads. */
export const DATA_CHANGED = 'interview-me:data-changed';

/** Loads data on mount; `reload` re-runs the loader. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(loader, deps);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    load()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(reload, [reload]);

  // Nikolai can add companies, interviewers and interviews from any page; reload when he does.
  useEffect(() => {
    window.addEventListener(DATA_CHANGED, reload);
    return () => window.removeEventListener(DATA_CHANGED, reload);
  }, [reload]);

  return { data, error, loading, reload, setData };
}
