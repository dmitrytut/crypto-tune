import * as Tone from 'tone';

/** Glide for every level change; long enough to never click. */
const LEVEL_RAMP_SEC = 0.8;

/**
 * Master bus shared by all layers:
 * layer volumes → reverb → glue compressor → limiter → master volume → speakers.
 * The limiter caps peaks so stacking layers and events can never clip.
 * @package
 */
export class Mixer {
  private readonly reverb = new Tone.Reverb({ decay: 9, preDelay: 0.04, wet: 0.35 });
  private readonly compressor = new Tone.Compressor({
    threshold: -22,
    ratio: 2.5,
    attack: 0.08,
    release: 0.4,
  });
  private readonly limiter = new Tone.Limiter(-1);
  private readonly master = new Tone.Volume(Number.NEGATIVE_INFINITY);

  constructor() {
    this.reverb.chain(this.compressor, this.limiter, this.master, Tone.getDestination());
  }

  /** Resolves once the reverb impulse response is generated (it is silent before). */
  get ready(): Promise<void> {
    return this.reverb.ready;
  }

  /** New layer input at `volumeDb`, routed into the bus. */
  createChannel(volumeDb: number): Tone.Volume {
    const ch = new Tone.Volume(volumeDb);
    ch.connect(this.reverb);
    return ch;
  }

  setLevel(node: Tone.Volume, db: number): void {
    node.volume.rampTo(db, LEVEL_RAMP_SEC);
  }

  fadeMaster(db: number, seconds: number): void {
    this.master.volume.rampTo(db, seconds);
  }
}
