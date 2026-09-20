export type CadPoint = Readonly<{ x: number; y: number }>;

export type CadCommandResult<T> =
  | { ok: true; value: T; message: string }
  | { ok: false; error: string };

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function rotatePoint(point: CadPoint, center: CadPoint, degrees: number): CadPoint {
  const radians = normalizeDegrees(degrees) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos + dy * sin,
    y: center.y - dx * sin + dy * cos,
  };
}

export function scalePoint(point: CadPoint, center: CadPoint, factor: number): CadPoint {
  return { x: center.x + (point.x - center.x) * factor, y: center.y + (point.y - center.y) * factor };
}
