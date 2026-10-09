import { pullAim, project } from './projection.js';

export class LauncherInput {
  constructor(element, runtime, getState, onChange, onGesture) {
    this.element = element; this.runtime = runtime; this.getState = getState;
    this.onChange = onChange; this.onGesture = onGesture;
    this.drag = null; this.keyboardAim = { x: 0, y: 1, z: 0, power: .8 };
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    element.addEventListener('pointerdown', event => this.down(event), options);
    element.addEventListener('pointermove', event => this.move(event), options);
    element.addEventListener('pointerup', event => this.finish(event, false), options);
    element.addEventListener('pointercancel', event => this.finish(event, true), options);
    element.addEventListener('lostpointercapture', event => this.finish(event, true), options);
    window.addEventListener('keydown', event => this.key(event), options);
  }
  local(event) {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  down(event) {
    if (event.button !== 0 || this.drag) return;
    const { screen, snapshot, layout } = this.getState();
    if (screen !== 'PLAY' || !snapshot?.hud?.canFire) return;
    const p = this.local(event);
    const anchor = snapshot.stellar?.playerPosition
      ? project(snapshot.stellar.playerPosition, layout) : { x: layout.width / 2, y: layout.control };
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) > 62) return;
    event.preventDefault(); this.onGesture();
    this.drag = { id: event.pointerId, anchorX: p.x, anchorY: p.y, anchor, aim: pullAim(0, 0) };
    this.element.setPointerCapture(event.pointerId);
    this.runtime.aim(0, 1, 0, .2, true); this.onChange(this.drag);
  }
  move(event) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    event.preventDefault();
    const p = this.local(event), aim = pullAim(p.x - this.drag.anchorX, p.y - this.drag.anchorY);
    this.drag.aim = aim;
    if (aim.valid) this.runtime.aim(aim.x, aim.y, 0, aim.power, false);
    this.onChange(this.drag);
  }
  finish(event, cancel) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    if (!cancel) this.move(event);
    const drag = this.drag; this.drag = null;
    this.runtime.fire(cancel || !drag.aim.valid);
    if (this.element.hasPointerCapture(drag.id)) this.element.releasePointerCapture(drag.id);
    this.onChange(null);
  }
  cancel() {
    if (!this.drag) return;
    this.finish({ pointerId: this.drag.id }, true);
  }
  key(event) {
    const { screen, snapshot } = this.getState();
    if (screen !== 'PLAY' || (/INPUT|BUTTON|SELECT|TEXTAREA/.test(event.target?.tagName || '')
      && event.target?.id !== 'launcher')) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!snapshot?.hud?.canFire) return;
    this.onGesture();
    let angle = Math.atan2(this.keyboardAim.x, this.keyboardAim.y);
    if (event.key === 'ArrowLeft') angle -= .05;
    if (event.key === 'ArrowRight') angle += .05;
    angle = Math.max(-65 * Math.PI / 180, Math.min(65 * Math.PI / 180, angle));
    if (event.key === 'ArrowUp') this.keyboardAim.power = Math.min(1, this.keyboardAim.power + .05);
    if (event.key === 'ArrowDown') this.keyboardAim.power = Math.max(.12, this.keyboardAim.power - .05);
    Object.assign(this.keyboardAim, { x: Math.sin(angle), y: Math.cos(angle) });
    this.runtime.aim(this.keyboardAim.x, this.keyboardAim.y, 0, this.keyboardAim.power, true);
    if (event.key === ' ' && !event.repeat) this.runtime.fire(false);
    this.onChange(null);
  }
  dispose() { this.cancel(); this.abort.abort(); }
}
