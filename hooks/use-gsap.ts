'use client';

import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/**
 * Why initial hidden states are set by GSAP (pre-paint) and never by CSS:
 * the server renders sections fully visible, so the page is complete before
 * hydration. If JS never runs, or a tween is aborted, nothing is ever hidden.
 * `prefers-reduced-motion` gets a hard CSS override on top as a second net.
 */

/**
 * True only when the user has asked the OS to minimise motion. Sections use
 * this to skip transforms entirely and just fade (or do nothing).
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Refresh every ScrollTrigger on the page. Sections that grow after async data
 * lands (StatsBar, FeaturedCreators, LiveActivity) call this once loaded so
 * trigger positions stay correct.
 */
export function refreshScrollTriggers() {
  if (typeof window === 'undefined') return;
  ScrollTrigger.refresh();
}

type Scope = HTMLElement | null;

/** Minimal structural type for GSAP's matchMedia instance. */
type MatchMedia = {
  add: (query: string, handler: () => void | (() => void)) => void;
  revert: () => void;
};

/**
 * The per-section animation context. Handles plugin registration, scope-safe
 * tween creation, automatic cleanup on unmount, and a `recover()` escape hatch
 * that forces animated children back to fully visible.
 *
 * Usage:
 *   const { ref, animate, recover } = useGsapSection<HTMLDivElement>();
 *   ...
 *   <section ref={ref}>...</section>
 *   animate((s, gsap, mm) => { mm.add('(min-width: 768px)', () => {...}) });
 */
export function useGsapSection<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);

  /**
   * Force every animated child of this section visible and kill pending tweens.
   * Wire into an error boundary so a failed tween can never hide content.
   */
  const recover = () => {
    const scope: Scope = ref.current;
    if (!scope) return;
    gsap.killTweensOf(scope.querySelectorAll('[data-anim]'));
    gsap.set(scope.querySelectorAll('[data-anim]'), {
      clearProps: 'opacity,transform,clipPath,filter',
    });
  };

  /**
  * Run a GSAP setup callback inside a layout-effect context tied to this
  * section's scope. Tweens are reverted when the section unmounts or deps change.
   */
  const animate = (
    setup: (
      scope: T,
      gsapInstance: typeof gsap,
      mm: MatchMedia,
    ) => void | (() => void),
    dependencies: unknown[] = [],
  ) => {
    useLayoutEffect(() => {
      const scope = ref.current;
      if (!scope) return;

      const mm = gsap.matchMedia();
      const ctx = gsap.context(() => setup(scope, gsap, mm), scope);

      return () => {
        mm.revert();
        ctx.revert();
      };
    }, dependencies);
  };

  // Never leave tweens running against a section that has unmounted.
  useLayoutEffect(() => {
    return () => {
      const scope: Scope = ref.current;
      if (scope) gsap.killTweensOf(scope.querySelectorAll('[data-anim]'));
    };
  }, []);

  return { ref, animate, recover };
}
