'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, Plus, X, Check, Video, Instagram, Youtube, Twitter, Music2, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { supabase, type Sponsorship, type Day, type Profile } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type SponsorshipData = Sponsorship & {
  days: Day;
  profiles: { name: string; username: string | null };
};

const platforms = [
  { value: 'instagram', label: 'Instagram Reel', icon: Instagram },
  { value: 'tiktok', label: 'TikTok', icon: Music2 },
  { value: 'youtube', label: 'YouTube Short', icon: Youtube },
  { value: 'x', label: 'X / Twitter', icon: Twitter },
  { value: 'other', label: 'Other', icon: LinkIcon },
] as const;

export default function ReviewPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [sponsorship, setSponsorship] = useState<SponsorshipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [existingReview, setExistingReview] = useState<any>(null);

  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pros, setPros] = useState<string[]>(['']);
  const [cons, setCons] = useState<string[]>(['']);
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoPlatform, setVideoPlatform] = useState<'instagram' | 'tiktok' | 'youtube' | 'x' | 'other'>('instagram');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (id) loadSponsorship(id as string);
  }, [id]);

  useEffect(() => {
    if (existingReview) {
      setRating(existingReview.rating);
      setTitle(existingReview.title || '');
      setContent(existingReview.content || '');
      setPros(existingReview.pros?.length ? existingReview.pros : ['']);
      setCons(existingReview.cons?.length ? existingReview.cons : ['']);
      setWouldRecommend(existingReview.would_recommend);
      setVideoUrl(existingReview.video_url || '');
      if (existingReview.video_platform) {
        setVideoPlatform(existingReview.video_platform);
      }
    }
  }, [existingReview]);

  const loadSponsorship = async (sponsorshipId: string) => {
    setLoading(true);

    const { data, error } = await supabase
      .from('sponsorships')
      .select(`
        *,
        days!inner(id, title, day_date, location),
        profiles!sponsorships_brand_id_fkey(name, username)
      `)
      .eq('id', sponsorshipId)
      .maybeSingle();

    if (error || !data) {
      setLoading(false);
      return;
    }

    setSponsorship(data as unknown as SponsorshipData);

    const { data: review } = await supabase
      .from('reviews')
      .select('*')
      .eq('sponsorship_id', sponsorshipId)
      .maybeSingle();

    if (review) setExistingReview(review);
    setLoading(false);
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!sponsorship) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Sponsorship not found</p>
        <Link href="/dashboard/creator"><Button variant="outline">Back to dashboard</Button></Link>
      </div>
    );
  }

  if (!user || profile?.id !== sponsorship.creator_id) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Only the creator can write this review</p>
        <Link href="/dashboard/creator"><Button variant="outline">Back to dashboard</Button></Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const cleanPros = pros.filter((p) => p.trim());
    const cleanCons = cons.filter((c) => c.trim());
    const cleanVideoUrl = videoUrl.trim() || null;

    if (existingReview) {
      const { error } = await supabase
        .from('reviews')
        .update({
          rating,
          title,
          content,
          pros: cleanPros,
          cons: cleanCons,
          would_recommend: wouldRecommend,
          video_url: cleanVideoUrl,
          video_platform: cleanVideoUrl ? videoPlatform : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingReview.id);

      if (error) {
        toast({ title: 'Failed to update review', description: error.message, variant: 'destructive' });
        setSubmitting(false);
        return;
      }
    } else {
      const { error } = await supabase.from('reviews').insert({
        sponsorship_id: sponsorship.id,
        rating,
        title,
        content,
        pros: cleanPros,
        cons: cleanCons,
        would_recommend: wouldRecommend,
        video_url: cleanVideoUrl,
        video_platform: cleanVideoUrl ? videoPlatform : null,
        published_at: new Date().toISOString(),
      });

      if (error) {
        toast({ title: 'Failed to publish review', description: error.message, variant: 'destructive' });
        setSubmitting(false);
        return;
      }

      await supabase
        .from('sponsorships')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', sponsorship.id);
    }

    toast({ title: existingReview ? 'Review updated!' : 'Review published!', description: 'Your honest review with video reel is now live.' });
    router.push('/dashboard/creator');
  };

  const dateStr = new Date(sponsorship.days.day_date).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/dashboard/creator" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
              Sponsored experience
            </Badge>
            {existingReview && <Badge variant="outline">Edit mode</Badge>}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2">
            Write your honest review
          </h1>
          <p className="text-muted-foreground">
            Your review of <span className="font-medium text-foreground">{sponsorship.profiles?.name}</span>&apos;s product
            from <span className="font-medium text-foreground">{sponsorship.days.title}</span> · {dateStr}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <div>
              <Label className="block mb-3">Your rating</Label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className={cn(
                        'h-8 w-8 transition-colors',
                        star <= rating ? 'text-amber-400 fill-amber-400' : 'text-border'
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Review title</Label>
              <Input
                id="title"
                placeholder="Great product for daily use"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Your experience</Label>
              <Textarea
                id="content"
                placeholder="Tell us about your real experience using this product during your day. What worked well? What didn't? Be honest — that's what makes this valuable."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Video className="h-5 w-5 text-accent" />
              <h3 className="font-semibold">Post a video reel or short</h3>
            </div>
            <p className="text-sm text-muted-foreground -mt-2">
              Record a short reel or video reviewing the product and post it on your social media. Paste the link here so the brand and your audience can see it.
            </p>

            <div className="space-y-3">
              <div>
                <Label className="block mb-2">Which platform did you post on?</Label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {platforms.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setVideoPlatform(p.value)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all',
                        videoPlatform === p.value
                          ? 'border-foreground bg-secondary'
                          : 'border-border hover:border-foreground/30'
                      )}
                    >
                      <p.icon className={cn('h-5 w-5', videoPlatform === p.value ? 'text-foreground' : 'text-muted-foreground')} />
                      <span className="text-xs font-medium">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="videoUrl">Reel / video URL</Label>
                <Input
                  id="videoUrl"
                  type="url"
                  placeholder="https://instagram.com/reel/..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Paste the full link to your posted reel or video. Leave empty if you haven&apos;t posted yet.
                </p>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
              <Label className="text-accent font-semibold">What you loved</Label>
              {pros.map((pro, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Add a pro..."
                    value={pro}
                    onChange={(e) => setPros((prev) => prev.map((p, idx) => idx === i ? e.target.value : p))}
                  />
                  {pros.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setPros((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPros((prev) => [...prev, ''])}
              >
                <Plus className="mr-1 h-3 w-3" /> Add pro
              </Button>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
              <Label className="text-destructive font-semibold">What you didn&apos;t like</Label>
              {cons.map((con, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Add a con..."
                    value={con}
                    onChange={(e) => setCons((prev) => prev.map((c, idx) => idx === i ? e.target.value : c))}
                  />
                  {cons.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setCons((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCons((prev) => [...prev, ''])}
              >
                <Plus className="mr-1 h-3 w-3" /> Add con
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <Label className="block mb-4">Would you buy this product yourself?</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setWouldRecommend(true)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-all flex items-center gap-3',
                  wouldRecommend ? 'border-accent bg-accent/5' : 'border-border hover:border-foreground/30'
                )}
              >
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  wouldRecommend ? 'bg-accent text-white' : 'bg-secondary'
                )}>
                  <Check className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Yes, I would</p>
                  <p className="text-xs text-muted-foreground">I genuinely recommend it</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setWouldRecommend(false)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-all flex items-center gap-3',
                  !wouldRecommend ? 'border-destructive bg-destructive/5' : 'border-border hover:border-foreground/30'
                )}
              >
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  !wouldRecommend ? 'bg-destructive text-white' : 'bg-secondary'
                )}>
                  <X className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-semibold text-sm">No, I wouldn&apos;t</p>
                  <p className="text-xs text-muted-foreground">Not for me</p>
                </div>
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="submit" size="lg" className="rounded-full flex-1" disabled={submitting}>
              {submitting ? 'Publishing...' : existingReview ? 'Update review' : 'Publish review'}
            </Button>
            <Button type="button" variant="outline" size="lg" asChild>
              <Link href="/dashboard/creator">Cancel</Link>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
