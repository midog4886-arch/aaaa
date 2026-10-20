// Only smooth visible joints on an uninterrupted track. Never manufacture
// landmarks across an occlusion or a change of selected athlete.
const visible = point => point && (point.visibility ?? 1) >= 0.5 && (point.presence ?? 1) >= 0.5;

export const stabilizePose = (previous, current, elapsedSeconds = 0.08) => {
  if (!Array.isArray(current)) return null;
  if (!Array.isArray(previous) || elapsedSeconds <= 0 || elapsedSeconds > 0.35) return current;
  const torso = [11, 12, 23, 24].map(index => current[index]).filter(visible);
  const span = torso.length >= 2
    ? Math.max(0.08, Math.max(...torso.map(point => point.y)) - Math.min(...torso.map(point => point.y)))
    : 0.18;
  // Allow fast sports motion, but reject isolated jumps larger than the body.
  const maxJump = Math.max(0.08, span * 1.1) + elapsedSeconds * 0.5;
  return current.map((point, index) => {
    const prior = previous[index];
    if (!visible(point) || !visible(prior)) return point;
    const displacement = Math.hypot(point.x - prior.x, point.y - prior.y);
    if (displacement > maxJump) return { ...point, visibility: 0, presence: 0 };
    const alpha = Math.min(0.9, Math.max(0.4, 0.4 + displacement / Math.max(span, 0.08)));
    return { ...point, x: prior.x + (point.x - prior.x) * alpha, y: prior.y + (point.y - prior.y) * alpha };
  });
};
