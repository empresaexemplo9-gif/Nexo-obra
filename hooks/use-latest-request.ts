"use client";
import { useCallback, useRef } from "react";

// Call from an event/effect before loading; only the newest request may publish its result.
export function useLatestRequest() {
  const sequence = useRef(0);
  return useCallback(() => {
    const current = ++sequence.current;
    return () => current === sequence.current;
  }, []);
}
