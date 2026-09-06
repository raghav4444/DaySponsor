'use client';

import { useState } from 'react';
import { Calendar, Package, Star, Search, CreditCard, Send, CheckCircle2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export function HowItWorks() {
  const [tab, setTab] = useState<'creators' | 'brands'>('creators');

  const creatorSteps = [
    { icon: Calendar, title: 'Create a day', desc: 'Describe what you\'re doing — coding, traveling, cooking. Set 3 sponsorship slots with your own prices.' },
    { icon: Search, title: 'Brands discover you', desc: 'Brands browse open days and pick a slot that fits their product and audience.' },
    { icon: Package, title: 'Receive the product', desc: 'The brand ships you their product. You use it as part of your real day.' },
    { icon: Star, title: 'Review honestly', desc: 'Share what you loved, what you didn\'t. Would you use it again? Your honest opinion, published.' },
  ];

  const brandSteps = [
    { icon: Search, title: 'Find a creator', desc: 'Browse creators by category, location, audience size, and date. Find someone whose day fits your product.' },
    { icon: CreditCard, title: 'Pick a slot & pay', desc: 'Choose from three tiers — Primary, Featured, or Supporting. Pay securely through Stripe.' },
    { icon: Send, title: 'Send your product', desc: 'Ship your product to the creator. They use it during their day and document the experience.' },
    { icon: CheckCircle2, title: 'Get authentic exposure', desc: 'Receive social mentions, photos, and an honest review. Real usage, real audience, real feedback.' },
  ];

  const steps = tab === 'creators' ? creatorSteps : brandSteps;

  return (
    <section id="how-it-works" className="py-20 bg-secondary/20 border-y border-border/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-sm font-medium text-accent mb-3">How it works</p>
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            Two sides.
            <span className="font-display italic font-normal"> One experience.</span>
          </h2>
        </div>

        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center rounded-full border border-border bg-card p-1">
            <button
              onClick={() => setTab('creators')}
              className={cn(
                'px-6 py-2 text-sm font-medium rounded-full transition-all',
                tab === 'creators'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              For Creators
            </button>
            <button
              onClick={() => setTab('brands')}
              className={cn(
                'px-6 py-2 text-sm font-medium rounded-full transition-all',
                tab === 'brands'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              For Brands
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <div
              key={step.title}
              className="group relative rounded-2xl border border-border bg-card p-6 transition-all hover:shadow-lg hover:-translate-y-1"
            >
              <div className="absolute top-6 right-6 text-5xl font-bold text-border/80 select-none">
                {i + 1}
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground text-background mb-4 transition-transform group-hover:scale-105">
                <step.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {step.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <MessageSquare className="h-4 w-4 text-accent" />
          <span>
            {tab === 'creators'
              ? 'Average creator earns €270 per sponsored day (after 10% platform fee)'
              : 'Average brand spends €179 per sponsorship, reaching ~15,000 people'}
          </span>
        </div>
      </div>
    </section>
  );
}
