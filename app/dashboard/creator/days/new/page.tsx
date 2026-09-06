'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { categories } from '@/lib/data';
import { cn } from '@/lib/utils';

type SlotDraft = {
  tier: 'Primary' | 'Featured' | 'Supporting';
  price: number;
  description: string;
};

export default function CreateDayPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dayDate, setDayDate] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('Developer');
  const [expectedReach, setExpectedReach] = useState('~10,000');
  const [slots, setSlots] = useState<SlotDraft[]>([
    { tier: 'Primary', price: 299, description: 'Product used throughout the day · Social mentions · Full review with photos' },
    { tier: 'Featured', price: 149, description: 'Product usage during the day · Social mention · Review with photo' },
    { tier: 'Supporting', price: 79, description: 'Product usage · Mention · Short review' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
    return <div className="min-h-screen pt-20 flex items-center justify-center"><p className="text-muted-foreground animate-pulse">Loading...</p></div>;
  }

  if (!user) {
    router.push('/login');
    return null;
  }

  if (profile?.role === 'brand') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Brand accounts cannot create days</p>
        <p className="text-sm text-muted-foreground">You need a creator account to publish sponsored days.</p>
        <Link href="/dashboard/brand"><Button variant="outline">Go to your dashboard</Button></Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (!title || !dayDate) {
      toast({ title: 'Missing fields', description: 'Please add a title and date.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    const { data: dayData, error: dayError } = await supabase
      .from('days')
      .insert({
        creator_id: profile.id,
        title,
        description,
        day_date: dayDate,
        location,
        category,
        expected_reach: expectedReach,
        status: 'live',
      })
      .select()
      .single();

    if (dayError || !dayData) {
      toast({ title: 'Failed to create day', description: dayError?.message, variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    const slotInserts = slots.map((slot, index) => ({
      day_id: dayData.id,
      tier: slot.tier,
      price: slot.price,
      position: index + 1,
      description: slot.description,
      is_available: true,
    }));

    const { error: slotsError } = await supabase
      .from('sponsorship_slots')
      .insert(slotInserts);

    if (slotsError) {
      toast({ title: 'Slots issue', description: slotsError.message, variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    toast({ title: 'Day published!', description: 'Your day is now live for brands to discover.' });
    router.push('/dashboard/creator');
  };

  const updateSlot = (index: number, field: keyof SlotDraft, value: string | number) => {
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/dashboard/creator" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">Create a new day</h1>
        <p className="text-muted-foreground mb-8">Tell brands what you&apos;re doing. Set your prices. Get sponsored.</p>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-semibold text-lg">Day details</h2>

            <div className="space-y-2">
              <Label htmlFor="title">Day title</Label>
              <Input
                id="title"
                placeholder="Building my AI startup"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What will you be doing? What's your day like? Help brands understand the context."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={dayDate}
                  onChange={(e) => setDayDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  placeholder="Rotterdam"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reach">Expected reach</Label>
                <Input
                  id="reach"
                  placeholder="~10,000"
                  value={expectedReach}
                  onChange={(e) => setExpectedReach(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Sponsorship slots</h2>
              <span className="text-xs text-muted-foreground">3 tiers · set your own prices</span>
            </div>

            <div className="space-y-4">
              {slots.map((slot, index) => (
                <div key={index} className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                      </span>
                      <span className="font-semibold">{slot.tier}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">€</span>
                      <Input
                        type="number"
                        value={slot.price}
                        onChange={(e) => updateSlot(index, 'price', parseInt(e.target.value) || 0)}
                        className="w-24"
                        min={1}
                      />
                    </div>
                  </div>
                  <Input
                    placeholder="What does this tier include?"
                    value={slot.description}
                    onChange={(e) => updateSlot(index, 'description', e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="submit" size="lg" className="rounded-full flex-1" disabled={submitting}>
              {submitting ? 'Publishing...' : 'Publish day'}
              {!submitting && <ArrowRight className="ml-2 h-4 w-4" />}
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
