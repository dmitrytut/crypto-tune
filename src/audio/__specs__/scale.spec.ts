import { describe, expect, it } from 'vitest';
import { degreeToMidi, pitchClassMidi } from '../scale';

describe('degreeToMidi', () => {
  const A3 = 57;

  it('walks the minor pentatonic upward across octaves', () => {
    // A C D E G | A …
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => degreeToMidi(A3, d))).toEqual([
      57, 60, 62, 64, 67, 69, 72,
    ]);
  });

  it('goes below the tonic for negative degrees', () => {
    // … E G | A
    expect([-2, -1, 0].map((d) => degreeToMidi(A3, d))).toEqual([52, 55, 57]);
    expect(degreeToMidi(A3, -5)).toBe(45);
  });
});

describe('pitchClassMidi', () => {
  it('maps pitch class and octave to MIDI with C4 = 60', () => {
    expect(pitchClassMidi(0, 4)).toBe(60);
    expect(pitchClassMidi(9, 3)).toBe(57);
    expect(pitchClassMidi(11, 2)).toBe(47);
  });
});
