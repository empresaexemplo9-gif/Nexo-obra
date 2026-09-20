import { useCallback, useReducer, type SetStateAction } from "react";

type Versioned = { id: string; revision: number };
type History<T> = { current: T | null; past: T[]; future: T[] };
type Action<T> = { type: "set"; value: SetStateAction<T | null> } | { type: "undo" | "redo" };

export function worksheetHistory<T extends Versioned>(state: History<T>, action: Action<T>): History<T> {
  if (action.type === "set") {
    const current = typeof action.value === "function" ? (action.value as (previous: T | null) => T | null)(state.current) : action.value;
    if (!current || current.id !== state.current?.id) return { current, past: [], future: [] };
    if (current === state.current) return state;
    // Server acknowledgements refresh the revision without adding an undo step.
    if (current.revision !== state.current.revision) return { ...state, current };
    return { current, past: [...state.past, state.current].slice(-50), future: [] };
  }
  if (!state.current) return state;
  const source = action.type === "undo" ? state.past : state.future;
  const previous = source.at(-1);
  if (!previous) return state;
  const current = { ...previous, revision: state.current.revision };
  return action.type === "undo"
    ? { current, past: state.past.slice(0, -1), future: [...state.future, state.current] }
    : { current, past: [...state.past, state.current], future: state.future.slice(0, -1) };
}

export function useWorksheetHistory<T extends Versioned>() {
  const [state, dispatch] = useReducer(worksheetHistory<T>, { current: null, past: [], future: [] });
  const set = useCallback((value: SetStateAction<T | null>) => dispatch({ type: "set", value }), []);
  return { current: state.current, set, undo: () => dispatch({ type: "undo" }), redo: () => dispatch({ type: "redo" }), canUndo: !!state.past.length, canRedo: !!state.future.length };
}
