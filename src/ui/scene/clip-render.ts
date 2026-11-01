import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny';
import type { ClipWindow, HistoryReplay } from '../../metrics/clip-buffer';
import { CLIP_FORMAT } from '../clip-format';
import { FlowMeter } from '../flow';
import { changeLabel, cueLabel, priceChange, priceDecimals, splitPrice } from '../format';
import {
  auraTarget,
  CALM_AURA,
  css,
  DOWN_COLOR,
  isDown,
  LIQUIDATION_PULSE,
  UP_COLOR,
} from '../palette';
import { Aura } from './aura';
import { Chart } from './chart';
import { CLIP_LAYOUT, CLIP_STAGE, type TextSpot } from './clip-layout';
import { Fx } from './fx';

/** Pair and watermark sit a step back from the price. */
const LABEL_ALPHA = 0.75;
/** Keeps text readable over a bright aura (the CSS --text-shadow-legible, for canvas). */
const TEXT_SHADOW = { color: 'rgb(0 0 0 / 0.7)', blur: 12, offsetY: 1 };

/** @package */
export interface ClipVideoInput {
  window: ClipWindow;
  history: HistoryReplay;
  /** The clip's music, without the pre-roll. */
  audio: AudioBuffer;
  /** Top line, e.g. `BTCUSDT` or `Simulated market`. */
  pair: string;
  watermark: string;
  periodMs: number;
  bigTradeUsd: number;
  liquidationUsd: number;
}

/**
 * Renders a clip faster than real time: the live scene classes on hidden phone-sized canvases,
 * stepped at the clip's frame rate through the window's trades, liquidations and ticks, then
 * composited with the price, the last event and the watermark into a 1080×1920 H.264 + AAC mp4.
 * Hands the main thread back after every frame so live audio keeps its schedule. Motion is full
 * whatever the viewer's reduced-motion setting: the clip is for other people's screens.
 */
export async function renderClipVideo(
  input: ClipVideoInput,
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const { window: w, history } = input;
  const ratio = CLIP_STAGE.pixelRatio;
  const L = CLIP_LAYOUT;
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  // Laid out (canvas sizes come from CSS) but off screen.
  Object.assign(stage.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${CLIP_STAGE.width}px`,
    height: `${CLIP_STAGE.height}px`,
    pointerEvents: 'none',
  });
  const layer = (x: number, y: number, width: number, height: number) => {
    const c = document.createElement('canvas');
    Object.assign(c.style, {
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    stage.append(c);
    return c;
  };
  const auraCanvas = layer(0, 0, CLIP_STAGE.width, CLIP_STAGE.height);
  const fxCanvas = layer(0, 0, CLIP_STAGE.width, CLIP_STAGE.height);
  const chartCanvas = layer(L.chart.x, L.chart.y, L.chart.width, L.chart.height);
  document.body.append(stage);

  const frame = document.createElement('canvas');
  frame.width = CLIP_FORMAT.width;
  frame.height = CLIP_FORMAT.height;
  const g = frame.getContext('2d');
  const aura = Aura.create(auraCanvas, CALM_AURA);
  let output: Output<Mp4OutputFormat, BufferTarget> | null = null;
  let finished = false;
  try {
    if (!g) throw new Error('2D canvas unavailable');
    let clockMs = 0;
    const chart = new Chart(
      chartCanvas,
      { matches: false },
      { pixelRatio: ratio, clock: () => clockMs },
    );
    const fx = new Fx(
      fxCanvas,
      {
        bloom: (x, y, color, strength) => aura?.bloom(x, y, color, strength),
        shock: (x, y, strength) => aura?.shock(x, y, strength),
        shake: () => {},
        touch: () => {},
      },
      ratio,
    );
    fx.setOrigin(L.origin.x, L.origin.y);
    fx.setFloor((x) => {
      const y = chart.lineY(x - L.chart.x);
      return y === null ? null : L.chart.y + y;
    });
    const flow = new FlowMeter();
    const look = getComputedStyle(stage);
    const background = getComputedStyle(document.body).backgroundColor;

    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const video = new CanvasSource(frame, {
      codec: 'avc',
      fullCodecString: CLIP_FORMAT.videoCodec,
      bitrate: CLIP_FORMAT.videoBitrate,
      keyFrameInterval: CLIP_FORMAT.keyFrameSec,
    });
    const audio = new AudioBufferSource({ codec: 'aac', bitrate: CLIP_FORMAT.audioBitrate });
    output.addVideoTrack(video, { frameRate: CLIP_FORMAT.fps });
    output.addAudioTrack(audio);
    await output.start();

    const text = (spot: TextSpot, s: string, color: string, alpha = 1) => {
      g.font = `${spot.weight} ${spot.size}px ${look.fontFamily}`;
      g.fillStyle = color;
      g.globalAlpha = alpha;
      g.fillText(s, CLIP_STAGE.width / 2, spot.y);
      g.globalAlpha = 1;
    };
    const decimals = priceDecimals(w.ticks.find((t) => t.snap)?.snap?.price ?? Number.NaN);
    let snap = w.ticks[0]?.snap ?? null;
    // Set from the tick callback below: typed wide so the check before drawing is not narrowed.
    let event = null as { text: string; down: boolean } | null;
    let tr = 0;
    let li = 0;
    let ti = 0;
    const dt = 1 / CLIP_FORMAT.fps;
    const frames = Math.round(((w.end - w.start) / 1000) * CLIP_FORMAT.fps);
    const clipFrom = Math.round((w.prerollMs / 1000) * CLIP_FORMAT.fps);
    for (let f = 0; f < frames; f++) {
      signal.throwIfAborted();
      const now = w.start + f * dt * 1000;
      clockMs = f * dt * 1000;
      tr = upTo(w.trades, tr, now, (t) => {
        flow.add(t.side, t.price * t.qty, t.ts);
        fx.trade(t.side, t.price * t.qty);
      });
      li = upTo(w.liquidations, li, now, (l) => {
        fx.liquidation(l.side, l.usd, input.liquidationUsd);
        if (l.usd >= input.liquidationUsd) aura?.pulseBy(LIQUIDATION_PULSE);
      });
      ti = upTo(w.ticks, ti, now, (tick) => {
        if (tick.snap) {
          snap = tick.snap;
          aura?.setTarget(auraTarget(tick.snap, flow.read(tick.ts)));
        }
        // Liquidation last: it is rarer and more important, so it wins the readout.
        const { trade, liquidation } = tick.cues;
        if (trade) event = { text: cueLabel('trade', trade), down: isDown(trade.side) };
        if (liquidation) {
          event = { text: cueLabel('liquidation', liquidation), down: isDown(liquidation.side) };
        }
      });
      history.advanceTo(now);
      aura?.frame(dt);
      fx.frame(dt, input.bigTradeUsd);
      chart.draw(history.series, now, input.periodMs);
      if (f < clipFrom) {
        await nextTask();
        continue;
      }

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = background;
      g.fillRect(0, 0, frame.width, frame.height);
      if (aura) g.drawImage(auraCanvas, 0, 0, frame.width, frame.height);
      g.drawImage(fxCanvas, 0, 0, frame.width, frame.height);
      g.drawImage(chartCanvas, L.chart.x * ratio, L.chart.y * ratio);
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.textAlign = 'center';
      g.shadowColor = TEXT_SHADOW.color;
      g.shadowBlur = TEXT_SHADOW.blur * ratio;
      g.shadowOffsetY = TEXT_SHADOW.offsetY * ratio;
      text(L.pair, input.pair, look.color, LABEL_ALPHA);
      if (snap && !Number.isNaN(snap.price)) {
        const { int, frac } = splitPrice(snap.price, decimals);
        text(L.price, int + frac, look.color);
        const moved = priceChange(history.series, snap.ts, snap.price, input.periodMs);
        if (moved) {
          const color =
            moved.pct > 0 ? css(UP_COLOR) : moved.pct < 0 ? css(DOWN_COLOR) : look.color;
          text(L.change, changeLabel(moved), color);
        }
      }
      if (event) text(L.event, event.text, css(event.down ? DOWN_COLOR : UP_COLOR));
      text(L.watermark, input.watermark, look.color, LABEL_ALPHA);
      g.shadowColor = 'transparent';

      await video.add((f - clipFrom) * dt, dt);
      onProgress((f + 1) / frames);
      await nextTask();
    }
    await audio.add(input.audio);
    await output.finalize();
    finished = true;
    const bytes = output.target.buffer;
    if (!bytes) throw new Error('Encoder produced no file');
    return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    // Aborted or failed: release the encoders now; a cancel after an encoder error may throw too.
    if (output && !finished) await output.cancel().catch(() => {});
    aura?.dispose();
    stage.remove();
  }
}

/** A new task: input, paint and live audio scheduling run before the next frame. */
function nextTask(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const ch = new MessageChannel();
  ch.port1.onmessage = () => resolve();
  ch.port2.postMessage(null);
  return promise;
}

/** Calls `fn` for the items of `xs` from index `i` up to time `now`; returns the next index. */
function upTo<T extends { ts: number }>(
  xs: readonly T[],
  i: number,
  now: number,
  fn: (x: T) => void,
): number {
  let next = i;
  for (let x = xs[next]; x && x.ts <= now; x = xs[++next]) fn(x);
  return next;
}
