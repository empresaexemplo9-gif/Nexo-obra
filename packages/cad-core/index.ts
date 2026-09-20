/** Geometry in millimetres. No UI, database or browser dependency. */
export type Point = { x: number; y: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Matrix = readonly [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export function transform(p: Point, m: Matrix): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export function rotation(degrees: number, origin: Point): Matrix {
  const c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
  return [c, -s, s, c, origin.x * (1 - c) - s * origin.y, origin.y * (1 - c) + s * origin.x];
}
export function scaling(factor: number, origin: Point): Matrix {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("A escala deve ser positiva e finita.");
  return [factor, 0, 0, factor, origin.x * (1 - factor), origin.y * (1 - factor)];
}
export function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
export function tangentPoints(p: Point, center: Point, radius: number): Point[] {
  const dx = p.x - center.x, dy = p.y - center.y, d2 = dx * dx + dy * dy;
  if (radius <= 0 || d2 < radius * radius) return [];
  const base = radius * radius / d2, offset = radius * Math.sqrt(d2 - radius * radius) / d2;
  const a = { x: center.x + base * dx - offset * dy, y: center.y + base * dy + offset * dx };
  return offset === 0 ? [a] : [a, { x: center.x + base * dx + offset * dy, y: center.y + base * dy - offset * dx }];
}
export function polar(origin: Point, target: Point, step = 45): Point {
  if (!(step > 0) || !Number.isFinite(step)) throw new Error("Passo polar inválido.");
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
  const angle = Math.round(Math.atan2(target.y - origin.y, target.x - origin.x) * 180 / Math.PI / step) * step * Math.PI / 180;
  return { x: origin.x + distance * Math.cos(angle), y: origin.y + distance * Math.sin(angle) };
}

/** Immutable command history; caller groups an entire gesture into one command. */
export class CommandHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(public current: T) {}
  execute(command: (state: T) => T): T {
    const next = command(this.current); // Failed transactions leave history intact.
    if (next !== this.current) { this.past.push(this.current); this.current = next; this.future = []; }
    return this.current;
  }
  undo(): T { if (this.past.length) { this.future.push(this.current); this.current = this.past.pop()!; } return this.current; }
  redo(): T { if (this.future.length) { this.past.push(this.current); this.current = this.future.pop()!; } return this.current; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
