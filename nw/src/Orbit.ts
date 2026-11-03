import * as Three from "three";

/** Look around from inside the space. The scene never rotates around an exhibit. */
export class Orbit {
  private azimuth = 0;
  private elevation = 0;
  private distance = 0;
  private pointer: {id: number; x: number; y: number} | null = null;
  private events = new AbortController();
  private direction = new Three.Vector3();
  constructor(private camera: Three.PerspectiveCamera, element: HTMLElement, private changed: () => void = () => {}) {
    element.style.touchAction = "none";
    const opts = {signal: this.events.signal};
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.pointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
      element.setPointerCapture(event.pointerId);
    }, opts);
    element.addEventListener("pointermove", (event) => {
      if (this.pointer?.id !== event.pointerId) return;
      this.azimuth -= (event.clientX - this.pointer.x) * 0.15;
      this.elevation = Three.MathUtils.clamp(this.elevation + (event.clientY - this.pointer.y) * 0.15, -65, 65);
      this.pointer.x = event.clientX; this.pointer.y = event.clientY;
      this.update();
    }, opts);
    const release = () => { this.pointer = null; };
    element.addEventListener("pointerup", release, opts);
    element.addEventListener("pointercancel", release, opts);
    element.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance = Three.MathUtils.clamp(this.distance + event.deltaY * 0.01, -20, 18);
      this.update();
    }, {...opts, passive: false});
    this.update();
  }
  set({azimuth = 0, elevation = 0, distance = 0}: {azimuth?: number; elevation?: number; distance?: number} = {}) {
    if (![azimuth, elevation, distance].every(Number.isFinite)) return;
    this.azimuth = azimuth; this.elevation = Three.MathUtils.clamp(elevation, -65, 65); this.distance = Three.MathUtils.clamp(distance, -20, 18);
    this.update();
  }
  private update() {
    const yaw = Three.MathUtils.degToRad(this.azimuth), pitch = Three.MathUtils.degToRad(this.elevation);
    this.camera.position.set(0, 0, this.distance);
    this.direction.set(Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch)).add(this.camera.position);
    this.camera.lookAt(this.direction);
    this.changed();
  }
  get view() { return {azimuth: this.azimuth, elevation: this.elevation, distance: this.distance}; }
  dispose() { this.events.abort(); }
}
