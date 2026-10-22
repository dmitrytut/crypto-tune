import type { AuraTarget, Rgb } from '../palette';

/** Render at this fraction of the screen; the soft upscale is part of the look and keeps the GPU idle. */
const RESOLUTION_SCALE = 0.25;
/** Seconds for colours / motion to settle on a new target. */
const COLOR_TAU_SEC = 1.6;
const MOTION_TAU_SEC = 0.8;
/** The drone filter LFO rate (base layer), so the aura breathes with the sound. */
const BREATH_HZ = 0.03;
const PULSE_DECAY_PER_SEC = 1.6;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Domain-warped value-noise fbm: two warps give the soft, tearing blobs. */
const FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform float uWarp;
uniform float uGlow;
uniform float uShift;

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
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  p.y -= uShift;
  float t = uTime;
  vec2 q = vec2(fbm(p * 1.2 + vec2(0.0, t)), fbm(p * 1.2 + vec2(5.2, -0.8 * t)));
  vec2 r = vec2(fbm(p * 1.4 + uWarp * q + vec2(1.7, 9.2) + 0.3 * t),
                fbm(p * 1.4 + uWarp * q + vec2(8.3, 2.8) - 0.4 * t));
  float f = fbm(p * 1.3 + uWarp * r);
  vec3 col = mix(vec3(0.02, 0.015, 0.05), uA, smoothstep(0.18, 0.62, f));
  col = mix(col, uB, smoothstep(0.48, 0.85, f));
  float vignette = smoothstep(1.45, 0.1, length(p));
  gl_FragColor = vec4(col * vignette * uGlow, 1.0);
}
`;

const approach = (cur: number, target: number, dt: number, tau: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / tau));
const approachRgb = (cur: Rgb, target: Rgb, dt: number, tau: number): Rgb => [
  approach(cur[0], target[0], dt, tau),
  approach(cur[1], target[1], dt, tau),
  approach(cur[2], target[2], dt, tau),
];

/**
 * Full-screen flowing aura. Targets come from `auraTarget()`; every value
 * glides toward its target so a jumpy market never makes the background jump.
 * Returns null when WebGL is unavailable (the CSS gradient behind stays).
 */
export class Aura {
  private readonly gl: WebGLRenderingContext;
  private readonly u: Record<
    'res' | 'time' | 'a' | 'b' | 'warp' | 'glow' | 'shift',
    WebGLUniformLocation | null
  >;
  private current: AuraTarget;
  private target: AuraTarget;
  /** Noise-space time; integrates speed so speed changes never jump the picture. */
  private flow = 0;
  private clock = 0;
  private pulse = 0;

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
      a: loc('uA'),
      b: loc('uB'),
      warp: loc('uWarp'),
      glow: loc('uGlow'),
      shift: loc('uShift'),
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

  /** Brief brightening, e.g. on a liquidation; `strength` 0…1. */
  pulseBy(strength: number): void {
    this.pulse = Math.min(1, this.pulse + strength);
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
    };
    this.flow += this.current.speed * dt;
    this.clock += dt;
    this.pulse *= Math.exp(-PULSE_DECAY_PER_SEC * dt);
    this.draw();
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
    gl.uniform3f(u.a, c.colorA[0], c.colorA[1], c.colorA[2]);
    gl.uniform3f(u.b, c.colorB[0], c.colorB[1], c.colorB[2]);
    gl.uniform1f(u.warp, c.warp);
    gl.uniform1f(u.glow, c.glow * breath * (1 + 0.5 * this.pulse));
    gl.uniform1f(u.shift, c.shiftY);
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
