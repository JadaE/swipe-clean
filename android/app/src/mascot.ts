// Lil Guy (pronouns: lil/guy), the little mascot. Pure logic only (no React Native) so it can be tested with tsx.
//
// The one rule: Lil is EQUALLY happy about every choice. Keep, Remove pile, Decide later, a compare pick and undo all draw
// from the same reaction pool with the same odds. Lil never looks sad, never celebrates one choice more than another,
// and never hints at what to pick.

export type MascotAction = 'keep' | 'remove' | 'later' | 'undo' | 'compare' | 'tap';
export const REACTIONS = ['hop', 'squish', 'wiggle', 'spin', 'sparkles', 'hearts'] as const;
export type Reaction = typeof REACTIONS[number];

/** Idle poses (Astro Bot style): after a quiet spell Lil briefly turns into one of these, then pops back. */
export const IDLE_POSES = ['camera', 'filmroll', 'polaroid', 'strap', 'frame', 'yawn', 'blink', 'look'] as const;
export type IdlePose = typeof IDLE_POSES[number];
export type Rng = () => number;

/** Same pool and same odds for every action. `action` is deliberately not used to pick. */
export function pickReaction(_action: MascotAction, rng: Rng = Math.random, last?: Reaction): Reaction {
  // avoid the exact same reaction twice in a row (applies identically to every action)
  const pool = last ? REACTIONS.filter(r => r !== last) : REACTIONS;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
export function reactionPool(_action: MascotAction): readonly Reaction[] { return REACTIONS; }

export const IDLE_MIN_MS = 8000, IDLE_MAX_MS = 12000, POSE_HOLD_MS = 2600;
/** How long the screen has to sit untouched before an idle pose: 8 to 12 seconds. */
export function idleDelay(rng: Rng = Math.random): number { return Math.round(IDLE_MIN_MS + rng() * (IDLE_MAX_MS - IDLE_MIN_MS)); }
export function pickIdlePose(rng: Rng = Math.random, last?: IdlePose): IdlePose {
  const pool = last ? IDLE_POSES.filter(p => p !== last) : IDLE_POSES;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Injectable clock so tests can drive time. Defaults to setTimeout/clearTimeout. */
export type Clock = { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realClock: Clock = { set: (f, ms) => setTimeout(f, ms), clear: h => clearTimeout(h as any) };

/**
 * Idle timer: fires onPose(pose) after 8–12 s without a poke, then onDone() POSE_HOLD_MS later, then re-arms.
 * poke() (any touch or decision) restarts the wait and cancels a pose in progress. Disabled = never fires.
 */
export class IdleTimer {
  private h: unknown = null; private last?: IdlePose; private enabled = false; posing = false;
  constructor(private onPose: (p: IdlePose) => void, private onDone: () => void, private rng: Rng = Math.random, private clock: Clock = realClock) {}
  start() { this.enabled = true; this.arm(); }
  stop() { this.enabled = false; this.clearH(); if (this.posing) { this.posing = false; this.onDone(); } }
  poke() { if (!this.enabled) return; if (this.posing) { this.posing = false; this.onDone(); } this.arm(); }
  get running() { return this.enabled; }
  private clearH() { if (this.h != null) { this.clock.clear(this.h); this.h = null; } }
  private arm() {
    this.clearH(); if (!this.enabled) return;
    this.h = this.clock.set(() => {
      this.h = null; if (!this.enabled) return;
      const p = pickIdlePose(this.rng, this.last); this.last = p; this.posing = true; this.onPose(p);
      this.h = this.clock.set(() => { this.h = null; this.posing = false; this.onDone(); this.arm(); }, POSE_HOLD_MS);
    }, idleDelay(this.rng));
  }
}

/** Tiny event bus so any screen's Lil hears decisions and touches without threading props everywhere. */
type Listener = (e: { kind: 'react'; action: MascotAction } | { kind: 'poke' }) => void;
const listeners = new Set<Listener>();
export const mascotBus = {
  react(action: MascotAction) { listeners.forEach(l => l({ kind: 'react', action })); },
  poke() { listeners.forEach(l => l({ kind: 'poke' })); },
  on(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
};

/** Lil's lines. Pronouns are lil/guy. Same warmth whatever you pick. */
export const LIL_A11Y = 'Lil, the Swipe Clean mascot. Lil is cheering you on whatever you pick. Give guy a tap to say hi.';
