import { useCallback, useRef, useState } from "react";

export function useSyncedRef<T>(initialValue: T) {
  const [state, setState] = useState<T>(initialValue);
  const ref = useRef<T>(initialValue);

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
      ref.current = next;
      return next;
    });
  }, []);

  return [state, setValue, ref] as const;
}
