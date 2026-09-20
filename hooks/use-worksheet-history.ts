import { useCallback, useReducer, type SetStateAction } from "react";
import { frase, TETO_CELULAS, TETO_PASSOS } from "@/lib/sheet-history";

type Versioned = { id: string; revision: number };
type History<T> = { current: T | null; past: T[]; future: T[]; pastLabels?: string[]; futureLabels?: string[] };
type Action<T> = { type: "set"; value: SetStateAction<T | null>; label?: string } | { type: "reset"; value: T | null } | { type: "undo" | "redo" };

function cellCount(value: unknown) {
  const sheet = value as { cells?: object; content?: { cells?: object } };
  return Object.keys(sheet.content?.cells ?? sheet.cells ?? {}).length;
}

export function worksheetHistory<T extends Versioned>(state: History<T>, action: Action<T>): History<T> {
  if (action.type === "reset") return { current: action.value, past: [], future: [], pastLabels: [], futureLabels: [] };
  if (action.type === "set") {
    const current = typeof action.value === "function" ? (action.value as (previous: T | null) => T | null)(state.current) : action.value;
    if (!current || current.id !== state.current?.id) return { current, past: [], future: [], pastLabels: [], futureLabels: [] };
    if (current === state.current) return state;
    // Server acknowledgements refresh the revision without adding an undo step.
    if (current.revision !== state.current.revision) return { ...state, current };
    if (JSON.stringify(current) === JSON.stringify(state.current)) return state;
    const past = [...state.past, state.current].slice(-TETO_PASSOS);
    const pastLabels = [...(state.pastLabels ?? state.past.map(() => "Alterar planilha")), action.label ?? "Alterar planilha"].slice(-TETO_PASSOS);
    let count = cellCount(current) + past.reduce((total, sheet) => total + cellCount(sheet), 0);
    while (past.length && count > TETO_CELULAS) { count -= cellCount(past.shift()); pastLabels.shift(); }
    return { current, past, pastLabels, future: [], futureLabels: [] };
  }
  if (!state.current) return state;
  const source = action.type === "undo" ? state.past : state.future;
  const previous = source.at(-1);
  if (!previous) return state;
  const current = { ...previous, revision: state.current.revision };
  return action.type === "undo"
    ? { current, past: state.past.slice(0, -1), future: [...state.future, state.current], pastLabels: state.pastLabels?.slice(0, -1), futureLabels: [...(state.futureLabels ?? []), state.pastLabels?.at(-1) ?? "Alterar planilha"] }
    : { current, past: [...state.past, state.current], future: state.future.slice(0, -1), pastLabels: [...(state.pastLabels ?? []), state.futureLabels?.at(-1) ?? "Alterar planilha"], futureLabels: state.futureLabels?.slice(0, -1) };
}

export function useWorksheetHistory<T extends Versioned>() {
  const [state, dispatch] = useReducer(worksheetHistory<T>, { current: null, past: [], future: [] });
  const set = useCallback((value: SetStateAction<T | null>, label?: string) => dispatch({ type: "set", value, label }), []);
  const reset = useCallback((value: T | null) => dispatch({ type: "reset", value }), []);
  return { current: state.current, set, reset, undo: () => dispatch({ type: "undo" }), redo: () => dispatch({ type: "redo" }), canUndo: !!state.past.length, canRedo: !!state.future.length,
    undoLabel: state.past.length ? frase("Desfazer", state.pastLabels?.at(-1) ?? "") : "Nada para desfazer",
    redoLabel: state.future.length ? frase("Refazer", state.futureLabels?.at(-1) ?? "") : "Nada para refazer" };
}
