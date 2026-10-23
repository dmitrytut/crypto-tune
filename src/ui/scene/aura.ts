import { type AuraTarget, backdropLuminance, type Rgb } from '../palette';

/** Render at this fraction of the screen; the soft upscale is part of the look and keeps the GPU idle. */
const RESOLUTION_SCALE = 0.33;
/** Seconds for colours / motion to settle on a new target. Short enough to feel a single trade burst. */
const COLOR_TAU_SEC = 0.9;
const MOTION_TAU_SEC = 0.6;
/** The drone filter LFO rate (base layer), so the aura breathes with the sound. */
const BREATH_HZ = 0.03;
const PULSE_DECAY_PER_SEC = 1.4;
const MAX_SHOCKS = 3;
const SHOCK_SEC = 2.2;
/** Ring expansion speed in screen heights per second. */
const SHOCK_SPEED = 0.6;
const MAX_BLOOMS = 6;
const BLOOM_DECAY_PER_SEC = 1.8;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * Domain-warped value-noise fbm (two warps → soft, tearing blobs), plus:
 * drift (order flow lifts/sinks the field), shock rings that displace the
 * field and glow (liquidations), and point blooms (large trades).
 */
const FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uDrift;
uniform vec3 uA;
uniform vec3 uB;
uniform float uWarp;
uniform float uGlow;
uniform float uShift;
uniform vec4 uShock[${MAX_SHOCKS}];
uniform vec4 uBloom[${MAX_BLOOMS}];
uniform vec3 uBloomColor[${MAX_BLOOMS}];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
void main() {
  vec2 screen = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  // Shock rings: push the field outward along a thin band and light the band.
  vec2 push = vec2(0.0);
  float ring = 0.0;
  for (int i = 0; i < ${MAX_SHOCKS}; i++) {
    vec4 s = uShock[i];
    vec2 d = screen - s.xy;
    float r = length(d) + 1e-4;
    float band = exp(-pow((r - s.z) * 12.0, 2.0)) * s.w;
    push += d / r * band * 0.12;
    ring += band;
  }

  vec2 p = screen + push + uDrift;
  p.y -= uShift;
  float t = uTime;
  vec2 q = vec2(fbm(p * 1.2 + vec2(0.0, t)), fbm(p * 1.2 + vec2(5.2, -0.8 * t)));
  vec2 r = vec2(fbm(p * 1.4 + uWarp * q + vec2(1.7, 9.2) + 0.3 * t),
                fbm(p * 1.4 + uWarp * q + vec2(8.3, 2.8) - 0.4 * t));
  float f = fbm(p * 1.3 + uWarp * r);

  vec3 col = mix(vec3(0.02, 0.015, 0.05), uA, smoothstep(0.18, 0.62, f));
  col = mix(col, uB, smoothstep(0.48, 0.85, f));
  // Hot cores lean toward white: the "juice" in the brightest folds.
  col += uB * smoothstep(0.78, 0.98, f) * 0.35;
  float vignette = smoothstep(1.45, 0.1, length(screen));
  col *= vignette * uGlow;
  col += uB * ring * 0.55;

  for (int i = 0; i < ${MAX_BLOOMS}; i++) {
    vec4 b = uBloom[i];
    vec2 d = screen - b.xy;
    col += uBloomColor[i] * b.z * exp(-dot(d, d) * 22.0);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const approach = (cur: number, target: number, dt: number, tau: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / tau));
const approachRgb = (cur: Rgb, target: Rgb, dt: number, tau: number): Rgb => [
  approach(cur[0], target[0], dt, tau),
  approach(cur[1], target[1], dt, tau),
  approach(cur[2], target[2], dt, tau),
];

interface Shock {
  x: number;
  y: number;
  age: number;
  strength: number;
}

interface Bloom {
  x: number;
  y: number;
  strength: number;
  color: Rgb;
}

type UniformName =
  | 'res'
  | 'time'
  | 'drift'
  | 'a'
  | 'b'
  | 'warp'
  | 'glow'
  | 'shift'
  | 'shock'
  | 'bloom'
  | 'bloomColor';

/**
 * Full-screen flowing aura. Targets come from `auraTarget()`; every value
 * glides toward its target so a jumpy market never makes the background jump.
 * Events land as shocks (liquidations) and blooms (large trades) at their
 * screen positions. `create` returns null without WebGL (the CSS gradient stays).
 * @package
 */
export class Aura {
  private readonly gl: WebGLRenderingContext;
  private readonly u: Record<UniformName, WebGLUniformLocation | null>;
  private current: AuraTarget;
  private target: AuraTarget;
  /** Noise-space time and drift; integrating them keeps speed changes from jumping the picture. */
  private flow = 0;
  private driftY = 0;
  private clock = 0;
  private pulse = 0;
  private shocks: Shock[] = [];
  private blooms: Bloom[] = [];
  private readonly shockBuf = new Float32Array(MAX_SHOCKS * 4);
  private readonly bloomBuf = new Float32Array(MAX_BLOOMS * 4);
  private readonly bloomColorBuf = new Float32Array(MAX_BLOOMS * 3);
  /** Readback for `backdropUnder`, grown to the largest region asked for. */
  private pixels = new Uint8Array(0);

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    initial: AuraTarget,
  ) {
    this.gl = gl;
    this.current = initial;
    this.target = initial;
    const loc = (n: string) => gl.getUniformLocation(program, n);
    this.u = {
      res: loc('uRes'),
      time: loc('uTime'),
      drift: loc('uDrift'),
      a: loc('uA'),
      b: loc('uB'),
      warp: loc('uWarp'),
      glow: loc('uGlow'),
      shift: loc('uShift'),
      shock: loc('uShock'),
      bloom: loc('uBloom'),
      bloomColor: loc('uBloomColor'),
    };
  }

  static create(canvas: HTMLCanvasElement, initial: AuraTarget): Aura | null {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return null;
    const program = link(gl);
    if (!program) return null;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    return new Aura(canvas, gl, program, initial);
  }

  setTarget(t: AuraTarget): void {
    this.target = t;
  }

  /** Brief overall brightening; `strength` 0…1. */
  pulseBy(strength: number): void {
    this.pulse = Math.min(1, this.pulse + strength);
  }

  /** Liquidation: a ring that tears outward through the field from (x, y) in CSS px. */
  shock(x: number, y: number, strength: number): void {
    this.shocks.push({ ...this.toField(x, y), age: 0, strength: Math.min(1, strength) });
    if (this.shocks.length > MAX_SHOCKS) this.shocks.shift();
  }

  /** Large trade: a soft burst of light at (x, y) in CSS px. */
  bloom(x: number, y: number, color: Rgb, strength: number): void {
    this.blooms.push({ ...this.toField(x, y), strength: Math.min(1.2, strength), color });
    if (this.blooms.length > MAX_BLOOMS) this.blooms.shift();
  }

  frame(dtSec: number): void {
    const dt = Math.min(dtSec, 0.1);
    const t = this.target;
    const c = this.current;
    this.current = {
      colorA: approachRgb(c.colorA, t.colorA, dt, COLOR_TAU_SEC),
      colorB: approachRgb(c.colorB, t.colorB, dt, COLOR_TAU_SEC),
      speed: approach(c.speed, t.speed, dt, MOTION_TAU_SEC),
      warp: approach(c.warp, t.warp, dt, MOTION_TAU_SEC),
      glow: approach(c.glow, t.glow, dt, MOTION_TAU_SEC),
      shiftY: approach(c.shiftY, t.shiftY, dt, COLOR_TAU_SEC),
      drift: approach(c.drift, t.drift, dt, MOTION_TAU_SEC),
    };
    this.flow += this.current.speed * dt;
    // Field coordinates move opposite to the drift so buying pressure reads as the light rising.
    this.driftY -= this.current.drift * dt;
    this.clock += dt;
    this.pulse *= Math.exp(-PULSE_DECAY_PER_SEC * dt);
    for (const s of this.shocks) s.age += dt;
    this.shocks = this.shocks.filter((s) => s.age < SHOCK_SEC);
    const fade = Math.exp(-BLOOM_DECAY_PER_SEC * dt);
    for (const b of this.blooms) b.strength *= fade;
    this.blooms = this.blooms.filter((b) => b.strength > 0.01);
    this.draw();
  }

  /**
   * How bright the aura is under `rect` (CSS px, window coordinates, as the canvas fills the
   * window): `backdropLuminance` of the frame just drawn. Call right after `frame`, in the same
   * animation frame: the drawing buffer is not kept once the frame is shown.
   */
  backdropUnder(rect: DOMRect): number {
    const { gl, canvas } = this;
    const sx = canvas.width / (canvas.clientWidth || 1);
    const sy = canvas.height / (canvas.clientHeight || 1);
    const x0 = Math.max(0, Math.floor(rect.left * sx));
    const x1 = Math.min(canvas.width, Math.ceil(rect.right * sx));
    // WebGL rows count from the bottom.
    const y0 = Math.max(0, Math.floor(canvas.height - rect.bottom * sy));
    const y1 = Math.min(canvas.height, Math.ceil(canvas.height - rect.top * sy));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return 0;
    if (this.pixels.length < w * h * 4) this.pixels = new Uint8Array(w * h * 4);
    const view = this.pixels.subarray(0, w * h * 4);
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);
    return backdropLuminance(view);
  }

  /** CSS px → shader space: centred, y up, unit = screen height. */
  private toField(x: number, y: number): { x: number; y: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight || 1;
    return { x: (x - w / 2) / h, y: (h / 2 - y) / h };
  }

  private draw(): void {
    const { gl, canvas, u, current: c } = this;
    const w = Math.max(1, Math.round(canvas.clientWidth * RESOLUTION_SCALE));
    const h = Math.max(1, Math.round(canvas.clientHeight * RESOLUTION_SCALE));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    const breath = 1 + 0.06 * Math.sin(2 * Math.PI * BREATH_HZ * this.clock);
    gl.uniform2f(u.res, w, h);
    gl.uniform1f(u.time, this.flow);
    gl.uniform2f(u.drift, 0, this.driftY);
    gl.uniform3f(u.a, c.colorA[0], c.colorA[1], c.colorA[2]);
    gl.uniform3f(u.b, c.colorB[0], c.colorB[1], c.colorB[2]);
    gl.uniform1f(u.warp, c.warp);
    gl.uniform1f(u.glow, c.glow * breath * (1 + 0.6 * this.pulse));
    gl.uniform1f(u.shift, c.shiftY);

    this.shockBuf.fill(0);
    for (const [i, s] of this.shocks.entries()) {
      const k = s.age / SHOCK_SEC;
      this.shockBuf.set([s.x, s.y, 0.04 + SHOCK_SPEED * s.age, s.strength * (1 - k) ** 2], i * 4);
    }
    gl.uniform4fv(u.shock, this.shockBuf);

    this.bloomBuf.fill(0);
    for (const [i, b] of this.blooms.entries()) {
      this.bloomBuf.set([b.x, b.y, b.strength, 0], i * 4);
      this.bloomColorBuf.set(b.color, i * 3);
    }
    gl.uniform4fv(u.bloom, this.bloomBuf);
    gl.uniform3fv(u.bloomColor, this.bloomColorBuf);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('Aura shader failed', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}
