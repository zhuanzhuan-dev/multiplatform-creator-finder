export const LAUNCHER_SIZE = 36;
const MARGIN = 8;
const clamp = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

export function normalizeLauncherPosition(value) {
  // Migrate the previous persisted vertical-only position without losing it.
  if (Number.isFinite(value)) return { x: 1, y: clamp(value, .65) };
  return { x: clamp(value?.x, 1), y: clamp(value?.y, .65) };
}
export function launcherCoordinates(value, width, height, size = LAUNCHER_SIZE) {
  const position = normalizeLauncherPosition(value);
  return {
    left: Math.min(MARGIN, Math.max(0, width - size)) + Math.max(0, width - size - 2 * MARGIN) * position.x,
    top: Math.min(MARGIN, Math.max(0, height - size)) + Math.max(0, height - size - 2 * MARGIN) * position.y
  };
}
export function launcherPositionFromPoint(left, top, width, height, size = LAUNCHER_SIZE) {
  return normalizeLauncherPosition({
    x: (left - MARGIN) / Math.max(1, width - size - 2 * MARGIN),
    y: (top - MARGIN) / Math.max(1, height - size - 2 * MARGIN)
  });
}
