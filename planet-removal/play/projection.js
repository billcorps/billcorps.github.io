// Matches the shared Java Projection layout. World XY is the screen plane, +Y up.
export const LAUNCHER_Y = -7.8;
export const MAX_PULL = 92;

export function projectionLayout(width, height, top = 0, bottom = 0, density = 1) {
  width = Math.max(1, width); height = Math.max(1, height);
  const dp = Number.isFinite(density) && density > 0 ? density : 1;
  let sceneTop = Math.max(0, top) + 52 * dp;
  let control = height - Math.max(0, bottom) - 112 * dp;
  if (control <= sceneTop) { sceneTop = height * .1; control = height * .8; }
  const scale = Math.max(.001, Math.min(Math.max(1, width - 40 * dp) / 6.9,
    (control - sceneTop) / (3.45 - LAUNCHER_Y)));
  const centerY = control + LAUNCHER_Y * scale;
  return { width, height, scale, centerY, control, top, bottom,
    halfWidth: width / (2 * scale), halfHeight: height / (2 * scale),
    worldCenterY: (centerY - height * .5) / scale };
}

export function project(position, layout) {
  return { x: layout.width * .5 + position.x * layout.scale,
    y: layout.centerY - position.y * layout.scale };
}

export function pullAim(dx, dy) {
  const length = Math.hypot(dx, dy);
  const valid = dy > 8 && length > 10;
  const angle = Math.max(-65 * Math.PI / 180, Math.min(65 * Math.PI / 180,
    Math.atan2(-dx, Math.max(1, dy))));
  return { valid, x: Math.sin(angle), y: Math.cos(angle), z: 0,
    power: Math.min(1, length / MAX_PULL), pull: valid ? Math.min(MAX_PULL, length) : 0 };
}
