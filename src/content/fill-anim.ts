/**
 * Staggered fill animation (the design's "Fill Trigger Concepts" motion):
 * per-field sky-blue flash + bounded cancellable cleanup.
 * Cosmetic only — never blocks or alters a fill's correctness.
 */

const STAGGER_MS = 130;
const FLASH_HOLD_MS = 720;
const FLASH_FADE_MS = 400;
const SETTLE_MS = 260;

const FLASH_BG = 'rgba(14,165,233,0.06)';
const FLASH_RING = '0 0 0 2px #0ea5e9, 0 0 0 6px rgba(14,165,233,0.18)';
const FLASH_TRANSITION = 'box-shadow .25s ease, background-color .4s ease';

type Saved = { boxShadow: string; backgroundColor: string; transition: string };

let runToken = 0;
const inflight = new Map<HTMLElement, Saved>();

export const FILL_ANIM = {
  STAGGER_MS,
  FLASH_HOLD_MS,
  FLASH_FADE_MS,
  SETTLE_MS,
} as const;

export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/** Briefly highlight a just-filled field. Saves & restores inline styles exactly. */
export function applyFlash(el: HTMLElement | null | undefined): void {
  if (!el) return;
  try {
    const saved: Saved = {
      boxShadow: el.style.boxShadow,
      backgroundColor: el.style.backgroundColor,
      transition: el.style.transition,
    };
    inflight.set(el, saved);
    el.style.transition = FLASH_TRANSITION;
    el.style.boxShadow = FLASH_RING;
    el.style.backgroundColor = FLASH_BG;
    setTimeout(() => {
      try {
        el.style.boxShadow = saved.boxShadow;
        el.style.backgroundColor = saved.backgroundColor;
        setTimeout(() => {
          try {
            el.style.transition = saved.transition;
          } catch {
            /* element detached */
          }
          inflight.delete(el);
        }, FLASH_FADE_MS);
      } catch {
        inflight.delete(el);
      }
    }, FLASH_HOLD_MS);
  } catch {
    /* a flash must never break a fill */
  }
}

/** Strip any in-flight flash styles and restore originals. */
export function clearFlashes(): void {
  for (const [el, saved] of inflight) {
    try {
      el.style.boxShadow = saved.boxShadow;
      el.style.backgroundColor = saved.backgroundColor;
      el.style.transition = saved.transition;
    } catch {
      /* detached */
    }
  }
  inflight.clear();
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Begin a fresh animation run; supersedes any previous one for cancellation checks. */
export function beginRun(): number {
  return ++runToken;
}

export function isCurrentRun(token: number): boolean {
  return token === runToken;
}
