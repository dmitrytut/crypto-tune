/** Minor pentatonic intervals in semitones above the tonic. */
const MINOR_PENTATONIC = [0, 3, 5, 7, 10] as const;
const SEMITONES_PER_OCTAVE = 12;

/**
 * MIDI note of a minor-pentatonic scale degree. Degree 0 is `tonicMidi`;
 * 5 is the tonic an octave up; negative degrees go below.
 */
export function degreeToMidi(tonicMidi: number, degree: number): number {
  const len = MINOR_PENTATONIC.length;
  const octave = Math.floor(degree / len);
  const step = degree - octave * len;
  return tonicMidi + octave * SEMITONES_PER_OCTAVE + (MINOR_PENTATONIC[step] as number);
}

/** MIDI note of pitch class `pc` (0 = C … 11 = B) in octave `octave` (C4 = 60). */
export function pitchClassMidi(pc: number, octave: number): number {
  return (octave + 1) * SEMITONES_PER_OCTAVE + pc;
}
