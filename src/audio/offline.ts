import * as Tone from 'tone';
import type { ClipWindow } from '../metrics/clip-buffer';
import {
  type AudioParams,
  buildGraph,
  Conductor,
  type Graph,
  LOOKAHEAD_SEC,
  startGraph,
} from './graph';

/**
 * The music of a clip, rendered faster than real time: the live layers built in an offline
 * context and played from the clip's ticks by the same Conductor as live. The pre-roll (fade-in,
 * reverb filling) is rendered and cut off. Needs no user gesture and leaves live audio alone:
 * Tone's global context points at the offline one only during the synchronous build.
 */
export async function renderClipAudio(
  w: ClipWindow,
  params: AudioParams,
  sampleRate: number,
): Promise<AudioBuffer> {
  const ctx = new Tone.OfflineContext(2, (w.end - w.start) / 1000, sampleRate);
  const live = Tone.getContext();
  Tone.setContext(ctx);
  let g: Graph;
  try {
    // shortcut: one synchronous task, ~100–200 ms at 4–6× CPU slowdown, so live audio can play
    // one note up to ~0.1 s late on a slow phone. Raising the live lookAhead meanwhile does not
    // help: lowering it back makes Tone's clock replay ticks it already ran (doubled notes). Build
    // with an explicit `context` per node across tasks if `clip_recorded` shows slow renders.
    const steps = buildGraph(params);
    let step = steps.next();
    while (!step.done) step = steps.next();
    g = step.value;
  } finally {
    Tone.setContext(live);
  }
  await g.mixer.ready;

  const conductor = new Conductor();
  // Tempo of the first tick from the start, like a live start mid-move.
  const first = w.ticks.find((t) => t.snap)?.snap;
  if (first) conductor.update(first, null, false);
  startGraph(g, conductor.bpm, LOOKAHEAD_SEC);
  for (const tick of w.ticks) {
    ctx.setTimeout(
      () => {
        if (tick.snap) conductor.update(tick.snap, g, true);
        conductor.play(tick.cues, g);
      },
      (tick.ts - w.start) / 1000,
    );
  }
  const rendered = (await ctx.render()).get();
  if (!rendered) throw new Error('Offline render produced no audio');

  const from = Math.round((w.prerollMs / 1000) * sampleRate);
  const length = rendered.length - from;
  const clip = new AudioBuffer({ length, numberOfChannels: rendered.numberOfChannels, sampleRate });
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    clip.copyToChannel(rendered.getChannelData(ch).subarray(from), ch);
  }
  return clip;
}
