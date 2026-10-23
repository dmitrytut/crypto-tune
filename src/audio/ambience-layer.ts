import * as Tone from 'tone';
import { degreeToMidi, midiToHz, pitchClassMidi } from './scale';
import { stepIndex } from './transport-step';

/** Bells start an octave above the arpeggio (A4 = 440 Hz). */
const BELL_OCTAVE = 4;
/**
 * Eno-style tape loops: each repeats one pentatonic note on its own period.
 * Periods are coprime, so the combined figure repeats only every
 * 7 · 11 · 13 = 1001 beats (~17 min at CALM_BPM). Degrees D, G, A over the A
 * tonic sit consonantly over every drone chord.
 */
const BELL_LOOPS = [
  { beats: 7, offsetBeats: 2, degree: 2, pan: -0.4 },
  { beats: 11, offsetBeats: 5, degree: 4, pan: 0.4 },
  { beats: 13, offsetBeats: 9, degree: 5, pan: 0 },
] as const;
/** Heartbeat on the tonic in octave 1 (A1 = 55 Hz), felt more than heard. */
const PULSE_OCTAVE = 1;
const PULSE_CUTOFF_HZ = 180;
/** Accent per beat of the bar: strong, soft, medium, soft. */
const PULSE_ACCENTS = [1, 0.55, 0.75, 0.55] as const;

/**
 * Always-on secondary voices in the base channel: three soft FM bells on
 * incommensurable loops, so the base never repeats audibly, and a quiet
 * heartbeat on every beat whose tempo carries the tension (see `tensionMix`).
 * Loops live on the transport timeline: transport start/stop drives them.
 * @package
 */
export class AmbienceLayer {
  private readonly pulse = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 1.5,
    envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 },
    volume: -14,
  });
  private readonly pulseFilter = new Tone.Filter({ type: 'lowpass', frequency: PULSE_CUTOFF_HZ });
  private tonicPc: number;

  constructor(output: Tone.InputNode, tonicPc: number) {
    this.tonicPc = tonicPc;
    this.pulse.chain(this.pulseFilter, output);
    const transport = this.pulse.context.transport;
    const ppq = transport.PPQ;

    for (const spec of BELL_LOOPS) {
      const bell = new Tone.FMSynth({
        harmonicity: 3,
        modulationIndex: 2,
        envelope: { attack: 0.005, decay: 2.5, sustain: 0, release: 2.5 },
        modulationEnvelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 0.8 },
        volume: -18,
      }).chain(new Tone.Panner(spec.pan), output);
      new Tone.Loop(
        (time) => {
          const midi = degreeToMidi(pitchClassMidi(this.tonicPc, BELL_OCTAVE), spec.degree);
          bell.triggerAttackRelease(midiToHz(midi), '4n', time, 0.35 + Math.random() * 0.2);
        },
        `${spec.beats * ppq}i`,
      ).start(`${spec.offsetBeats * ppq}i`);
    }

    new Tone.Loop((time) => {
      // Beat in the bar from the transport, so accents stay on the bar after a restart.
      const beat = stepIndex(transport.getTicksAtTime(time), ppq, PULSE_ACCENTS.length);
      this.pulse.triggerAttackRelease(
        midiToHz(pitchClassMidi(this.tonicPc, PULSE_OCTAVE)),
        '8n',
        time,
        PULSE_ACCENTS[beat] as number,
      );
    }, '4n').start(0);
  }

  setTonic(pc: number): void {
    // Next notes take the new tonic; bells and pulse are short enough to need no glide.
    this.tonicPc = pc;
  }
}
