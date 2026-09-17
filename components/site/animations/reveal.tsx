'use client';

import { gsap, ScrollTrigger, useGsapSection } from '@/hooks/use-gsap';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const VARIANTS: Record<string, gsap.TweenVars> = {
  'fade-up': { y: 40, opacity: 0 },
  'fade-down': { y: -40, opacity: 0 },
  'fade-left': { x: -50, opacity: 0 },
  'fade-right': { x: 50, opacity: 0 },
  fade: { opacity: 0 },
  scale: { scale: 0.92, opacity: 0 },
  blur: { opacity: 0, filter: 'blur(12px)' },
  pop: { scale: 0.8, opacity: 0 },
};

/**
 * Reusable scroll-reveal wrapper. GSAP sets the "from" state in a layout
 * effect *before paint*, so nothing is ever hidden if JS fails — the
 * server-rendered markup is already fully visible.
 *
 * `stagger` animates direct children instead of the wrapper itself.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  variant = 'fade-up',
  delay = 0,
  duration = 0.8,
  className,
  stagger,
  ...props
}: {
  children: React.ReactNode;
  as?: React.ElementType;
  variant?: keyof typeof VARIANTS;
  delay?: number;
  duration?: number;
  className?: string;
  stagger?: number;
} & React.HTMLAttributes<HTMLElement>) {
  const { ref, animate } = useGsapSection<HTMLElement>();

  animate(() => {
    const target = stagger ? ref.current?.children : ref.current;
    if (!target) return;
    gsap.from(target, {
      ...VARIANTS[variant],
      duration,
      delay,
      ease: 'power3.out',
      stagger: stagger || 0,
      scrollTrigger: {
        trigger: ref.current,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
    });
  });

  return (
    <Tag ref={ref} data-anim className={cn(className)} {...props}>
      {children}
    </Tag>
  );
}
