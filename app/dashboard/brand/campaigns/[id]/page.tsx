'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Clock, Package, Star, ExternalLink, Video, Instagram, Youtube, Twitter, Music2, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { supabase, type Sponsorship, type Day, type Profile, type Review, type Deliverable } from '@/lib/supabase';

type CampaignData = Sponsorship & {
  days: Day;
  profiles: { name: string; username: string | null };
  reviews: Review[];
  deliverables: Deliverable[];
};

export default function CampaignDetailPage() {
  const { id } = useParams();
  const { profile, loading: authLoading } = useAuth();
  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadCampaign(id as string);
  }, [id]);

  const loadCampaign = async (campaignId: string) => {
    setLoading(true);

    const { data, error } = await supabase
      .from('sponsorships')
      .select(`
        *,
        days!inner(*),
        profiles!sponsorships_creator_id_fkey(name, username),
        reviews(*),
        deliverables(*)
      `)
      .eq('id', campaignId)
      .maybeSingle();

    if (error || !data) {
      setLoading(false);
      return;
    }

    setCampaign(data as unknown as CampaignData);
    setLoading(false);
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading campaign...</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Campaign not found</p>
        <Link href="/dashboard/brand"><Button variant="outline">Back to dashboard</Button></Link>
      </div>
    );
  }

  const dateStr = new Date(campaign.days.day_date).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const statusSteps = [
    { key: 'paid', label: 'Payment confirmed', icon: Check },
    { key: 'product_shipped', label: 'Product shipped', icon: Package },
    { key: 'product_received', label: 'Product received', icon: Package },
    { key: 'day_completed', label: 'Day completed', icon: Clock },
    { key: 'review_pending', label: 'Review pending', icon: Clock },
    { key: 'completed', label: 'Review published', icon: Star },
  ];

  const currentStepIndex = statusSteps.findIndex((s) => s.key === campaign.status);

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/dashboard/brand" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{campaign.days.title}</h1>
              <p className="text-muted-foreground mt-1">
                by @{campaign.profiles?.username || campaign.profiles?.name} · {dateStr}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold">€{campaign.amount}</p>
              <p className="text-xs text-muted-foreground">Your investment</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-border">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Creator</p>
              <p className="font-semibold mt-1">{campaign.profiles?.name}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</p>
              <p className="font-semibold mt-1">{dateStr.split(',')[0]}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
              <p className="font-semibold mt-1 capitalize">{campaign.status.replace('_', ' ')}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 mb-6">
          <h2 className="font-semibold text-lg mb-6">Campaign progress</h2>
          <div className="space-y-4">
            {statusSteps.map((step, i) => {
              const isDone = i < currentStepIndex || campaign.status === 'completed';
              const isCurrent = i === currentStepIndex && campaign.status !== 'completed';
              const isPending = i > currentStepIndex;

              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                    isDone ? 'bg-accent text-white' : isCurrent ? 'bg-amber-500/20 text-amber-600' : 'bg-secondary text-muted-foreground'
                  }`}>
                    <step.icon className="h-4 w-4" />
                  </div>
                  <span className={`text-sm ${isPending ? 'text-muted-foreground' : 'font-medium'}`}>
                    {step.label}
                  </span>
                  {isDone && <Check className="h-4 w-4 text-accent ml-auto" />}
                  {isCurrent && <span className="ml-auto text-xs text-amber-600 font-medium">In progress</span>}
                </div>
              );
            })}
          </div>
        </div>

        {campaign.deliverables && campaign.deliverables.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-8 mb-6">
            <h2 className="font-semibold text-lg mb-4">Deliverables</h2>
            <div className="space-y-3">
              {campaign.deliverables.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      d.status === 'completed' ? 'bg-accent/10 text-accent' : 'bg-secondary text-muted-foreground'
                    }`}>
                      {d.status === 'completed' ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium capitalize">{d.type.replace('_', ' ')}</p>
                      {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                    </div>
                  </div>
                  {d.url && d.status === 'completed' && (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-sm flex items-center gap-1">
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {campaign.reviews && campaign.reviews.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Honest review</h2>
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">Sponsored experience</Badge>
            </div>
            {campaign.reviews.map((review) => (
              <div key={review.id}>
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-5 w-5 ${i < review.rating ? 'text-amber-400 fill-amber-400' : 'text-border'}`}
                    />
                  ))}
                </div>
                {review.title && <p className="font-semibold mb-2">{review.title}</p>}
                {review.content && <p className="text-muted-foreground leading-relaxed mb-4">{review.content}</p>}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {review.pros && review.pros.length > 0 && (
                    <div>
                      <p className="font-semibold text-accent mb-2">What they loved</p>
                      {review.pros.map((p, i) => (
                        <p key={i} className="text-muted-foreground">+ {p}</p>
                      ))}
                    </div>
                  )}
                  {review.cons && review.cons.length > 0 && (
                    <div>
                      <p className="font-semibold text-destructive mb-2">What they didn&apos;t</p>
                      {review.cons.map((c, i) => (
                        <p key={i} className="text-muted-foreground">- {c}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-sm text-muted-foreground">
                    Would they buy it themselves?{' '}
                    <span className={`font-semibold ${review.would_recommend ? 'text-accent' : 'text-destructive'}`}>
                      {review.would_recommend ? 'Yes' : 'No'}
                    </span>
                  </p>
                </div>

                {review.video_url && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex items-center gap-2 mb-3">
                      <Video className="h-4 w-4 text-accent" />
                      <p className="text-sm font-semibold">Video reel review</p>
                      {review.video_platform && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground capitalize">
                          on {review.video_platform}
                        </span>
                      )}
                    </div>
                    <a
                      href={review.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/70 transition-colors"
                    >
                      {review.video_platform === 'instagram' && <Instagram className="h-4 w-4" />}
                      {review.video_platform === 'tiktok' && <Music2 className="h-4 w-4" />}
                      {review.video_platform === 'youtube' && <Youtube className="h-4 w-4" />}
                      {review.video_platform === 'x' && <Twitter className="h-4 w-4" />}
                      {review.video_platform === 'other' && <LinkIcon className="h-4 w-4" />}
                      Watch the reel
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
