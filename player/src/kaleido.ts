/**
 * True screen-space kaleidoscope as a postprocessing Effect.
 * `sides` is downbeat-quantized by the conductor; `amount` morphs the fold
 * in continuously (0 = untouched world, 1 = full mandala), so the mirror
 * BLOOMS OPEN as drops approach instead of snapping.
 */
import { Effect } from "postprocessing";
import { Uniform } from "three";

const frag = /* glsl */ `
uniform float sides;
uniform float angle;
uniform float amount;

void mainUv(inout vec2 uv) {
  if (amount < 0.002 || sides < 2.0) return;
  float aspect = resolution.x / resolution.y;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= aspect;
  float r = length(p);
  float a = atan(p.y, p.x) + angle;
  float tau = 6.28318530718;
  float sector = tau / sides;
  a = mod(a, sector);
  a = abs(a - sector * 0.5);
  vec2 folded = r * vec2(cos(a), sin(a));
  folded.x /= aspect;
  folded = folded * 0.5 + 0.5;
  uv = mix(uv, folded, amount);
}
`;

export class KaleidoscopeEffect extends Effect {
  constructor() {
    super("KaleidoscopeEffect", frag, {
      uniforms: new Map<string, Uniform>([
        ["sides", new Uniform(6)],
        ["angle", new Uniform(0)],
        ["amount", new Uniform(0)],
      ]),
    });
  }

  set(sides: number, angle: number, amount: number) {
    this.uniforms.get("sides")!.value = sides;
    this.uniforms.get("angle")!.value = angle;
    this.uniforms.get("amount")!.value = amount;
  }
}
