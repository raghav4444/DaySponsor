import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Mail, Sparkles } from 'lucide-react';
import { Footer } from '@/components/site/footer';
import { Navbar } from '@/components/site/navbar';

const pageContent = {
  pricing: {
    eyebrow: 'Platform',
    title: 'Simple pricing for real-world reach.',
    intro: 'Creators set the context. Brands choose the moment. Every sponsorship is priced around the experience being delivered.',
    points: ['Clear sponsorship slots', 'No hidden platform fees', 'Payment held until the experience is complete'],
    cta: 'Explore available days',
    href: '/explore',
  },
  about: {
    eyebrow: 'About DaySponsor',
    title: 'A better way to show up in someone’s day.',
    intro: 'DaySponsor helps brands become part of real creator experiences, with the honesty and context that traditional ads cannot provide.',
    points: ['Real products in real routines', 'Creators keep their independent voice', 'Brands get useful, human feedback'],
    cta: 'See how it works',
    href: '/#how-it-works',
  },
  blog: {
    eyebrow: 'DaySponsor Journal',
    title: 'Ideas for better creator partnerships.',
    intro: 'We are building a more useful relationship between brands and creators. Our journal will cover thoughtful sponsorships, honest reviews, and the work behind both.',
    points: ['Creator economy field notes', 'Practical brand partnership advice', 'Stories from sponsored days'],
    cta: 'Contact the team',
    href: '/contact',
  },
  careers: {
    eyebrow: 'Careers',
    title: 'Help make advertising feel human again.',
    intro: 'We are a small team building a marketplace where useful products meet real lives. We value clear thinking, good taste, and work that earns trust.',
    points: ['Remote-friendly collaboration', 'High ownership and low ceremony', 'A product with visible human impact'],
    cta: 'Start a conversation',
    href: '/contact',
  },
  press: {
    eyebrow: 'Press',
    title: 'Stories worth covering.',
    intro: 'For company information, founder conversations, product access, or commentary on creator partnerships, reach our team directly.',
    points: ['Company background and product details', 'Founder and creator interviews', 'Press-ready brand assets on request'],
    cta: 'Email press@daysponsor.app',
    href: 'mailto:press@daysponsor.app',
  },
  contact: {
    eyebrow: 'Contact',
    title: 'Let’s talk about the next sponsored day.',
    intro: 'Whether you are a creator, a brand, or simply curious about the model, send us a note and we will point you in the right direction.',
    points: ['Creators: tell us what your day looks like', 'Brands: share what you want people to experience', 'Partners: ask about working together'],
    cta: 'Email hello@daysponsor.app',
    href: 'mailto:hello@daysponsor.app',
  },
  terms: {
    eyebrow: 'Legal',
    title: 'Terms of service.',
    intro: 'These terms describe the basic rules for using DaySponsor, creating listings, sponsoring experiences, and participating in the marketplace.',
    points: ['Use accurate account and listing information', 'Respect creator and brand commitments', 'Keep communication and payments on the platform'],
    cta: 'Contact us about these terms',
    href: '/contact',
  },
  privacy: {
    eyebrow: 'Legal',
    title: 'Privacy, without the mystery.',
    intro: 'We collect the information needed to run the marketplace, protect accounts, process sponsorships, and improve the product. We do not sell personal data.',
    points: ['You control your account information', 'Payments are handled by trusted providers', 'You can ask what we store or request deletion'],
    cta: 'Ask a privacy question',
    href: 'mailto:privacy@daysponsor.app',
  },
  'trust-safety': {
    eyebrow: 'Trust & Safety',
    title: 'Good experiences need clear boundaries.',
    intro: 'DaySponsor is built around informed participation. We review reports, protect honest feedback, and do not allow harassment, deception, or unsafe requests.',
    points: ['Report a concern and get a human review', 'No guaranteed positive reviews', 'Clear expectations before money changes hands'],
    cta: 'Report a concern',
    href: 'mailto:safety@daysponsor.app',
  },
  'review-policy': {
    eyebrow: 'Review Policy',
    title: 'Honest opinions are the product.',
    intro: 'Creators are paid for completing an agreed experience, never for saying something positive. Reviews should reflect what they genuinely observed.',
    points: ['Creators keep editorial independence', 'Brands may respond, but not rewrite', 'Fraudulent or manipulated reviews are removed'],
    cta: 'Read the trust principles',
    href: '/trust-safety',
  },
  'cookie-policy': {
    eyebrow: 'Legal',
    title: 'A small cookie policy.',
    intro: 'DaySponsor uses essential storage to keep the product secure and remember your choices. Optional analytics should only help us understand product use in aggregate.',
    points: ['Essential cookies keep the app working', 'Analytics are used to improve the experience', 'You can manage cookies in your browser'],
    cta: 'Contact us about cookies',
    href: '/contact',
  },
} as const;

type PageSlug = keyof typeof pageContent;

export function generateStaticParams() {
  return Object.keys(pageContent).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const page = pageContent[params.slug as PageSlug];
  return page ? { title: `${page.title} | DaySponsor`, description: page.intro } : {};
}

export default function ContentPage({ params }: { params: { slug: string } }) {
  const page = pageContent[params.slug as PageSlug];

  if (!page) notFound();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="relative overflow-hidden border-b border-border/50 py-24 sm:py-32">
          <div className="absolute inset-0 grid-bg opacity-40" />
          <div className="relative mx-auto max-w-5xl px-5 sm:px-6 lg:px-8">
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.16em] text-accent">{page.eyebrow}</p>
            <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
              <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">{page.title}</h1>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{page.intro}</p>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-24">
          <div className="mx-auto grid max-w-5xl gap-10 px-5 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div className="rounded-2xl bg-foreground p-7 text-background sm:p-9">
              <Sparkles className="mb-16 h-6 w-6" />
              <p className="text-sm leading-relaxed text-background/70">DaySponsor is a marketplace for useful, transparent partnerships between people and brands.</p>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {page.points.map((point) => (
                <div key={point} className="flex gap-4 py-5 text-base sm:text-lg">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <span>{point}</span>
                </div>
              ))}
              <Link href={page.href} className="group flex items-center gap-2 py-6 font-medium">
                {page.cta}
                {page.href.startsWith('mailto:') ? <Mail className="h-4 w-4" /> : <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
