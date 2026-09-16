'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  User,
  Mail,
  MapPin,
  Edit3,
  Save,
  X,
  LogOut,
  ArrowLeft,
  Camera,
  Star,
  Calendar,
  DollarSign,
  Shield,
  ExternalLink,
  Instagram,
  Youtube,
  Twitter,
  Music2,
  Globe,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { supabase, type CreatorProfile } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export default function ProfilePage() {
  const { user, profile, loading: authLoading, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [occupation, setOccupation] = useState('');
  const [location, setLocation] = useState('');
  const [followers, setFollowers] = useState('');
  const [impressions, setImpressions] = useState('');
  const [audienceDescription, setAudienceDescription] = useState('');
  const [socialLinks, setSocialLinks] = useState<string[]>(['']);

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setUsername(profile.username || '');
      setBio(profile.bio || '');
      loadCreatorProfile();
    }
  }, [profile]);

  const loadCreatorProfile = async () => {
    if (!profile) return;
    setLoading(true);

    if (profile.role === 'creator') {
      const { data } = await supabase
        .from('creator_profiles')
        .select('*')
        .eq('profile_id', profile.id)
        .maybeSingle();

      if (data) {
        const cp = data as CreatorProfile;
        setCreatorProfile(cp);
        setOccupation(cp.occupation || '');
        setLocation(cp.location || '');
        setFollowers(cp.followers || '');
        setImpressions(cp.impressions || '');
        setAudienceDescription(cp.audience_description || '');
        setSocialLinks(cp.social_links?.length ? cp.social_links : ['']);
      }
    }

    setLoading(false);
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        name: name.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    if (profileError) {
      toast({ title: 'Failed to save', description: profileError.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    if (profile.role === 'creator') {
      const cleanLinks = socialLinks.filter((l) => l.trim());
      const { error: cpError } = await supabase
        .from('creator_profiles')
        .update({
          occupation: occupation.trim() || null,
          location: location.trim() || null,
          followers: followers.trim(),
          impressions: impressions.trim(),
          audience_description: audienceDescription.trim() || null,
          social_links: cleanLinks,
        })
        .eq('profile_id', profile.id);

      if (cpError) {
        toast({ title: 'Failed to save creator profile', description: cpError.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
    }

    await refreshProfile();
    toast({ title: 'Profile saved!', description: 'Your changes are live.' });
    setEditing(false);
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading profile...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Please sign in to view your profile</p>
        <Button asChild className="rounded-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  const dashboardHref = profile.role === 'brand' ? '/dashboard/brand' : profile.role === 'admin' ? '/dashboard/admin' : '/dashboard/creator';

  const getSocialIcon = (url: string) => {
    if (url.includes('instagram')) return Instagram;
    if (url.includes('tiktok')) return Music2;
    if (url.includes('youtube')) return Youtube;
    if (url.includes('twitter') || url.includes('x.com')) return Twitter;
    return Globe;
  };

  return (
    <div className="min-h-screen pt-20 bg-background">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8 animate-fade-up opacity-0-init">
          <Link
            href={dashboardHref}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <div className="flex items-center gap-2">
            {!editing ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setEditing(true)}
              >
                <Edit3 className="mr-2 h-4 w-4" />
                Edit profile
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setEditing(false)}
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Profile header card */}
        <div className="rounded-2xl border border-border bg-card p-8 mb-6 animate-fade-up opacity-0-init delay-100">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center text-background text-3xl font-bold">
                {profile.name?.charAt(0).toUpperCase() || '?'}
              </div>
              {editing && (
                <button className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background border-2 border-background hover:scale-110 transition-transform">
                  <Camera className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-xs">Display name</Label>
                      <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-xs">Username</Label>
                      <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="yourhandle" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bio" className="text-xs">Bio</Label>
                    <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell brands and creators about yourself…" rows={2} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs font-semibold capitalize',
                        profile.role === 'admin' ? 'border-destructive/30 text-destructive' :
                        profile.role === 'creator' ? 'border-accent/30 text-accent' :
                        'border-blue-500/30 text-blue-600',
                      )}
                    >
                      {profile.role}
                    </Badge>
                  </div>
                  {profile.username && (
                    <p className="text-muted-foreground mt-0.5">@{profile.username}</p>
                  )}
                  {profile.bio && (
                    <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{profile.bio}</p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Account info row */}
          <div className="mt-6 pt-6 border-t border-border flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Mail className="h-4 w-4" />
              {profile.email}
            </span>
            {creatorProfile?.location && !editing && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {creatorProfile.location}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* Creator-specific stats */}
        {profile.role === 'creator' && creatorProfile && !editing && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 animate-fade-up opacity-0-init delay-200">
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <p className="text-2xl font-bold text-accent">{creatorProfile.followers}</p>
              <p className="text-xs text-muted-foreground mt-1">Followers</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <p className="text-2xl font-bold">{creatorProfile.impressions}</p>
              <p className="text-xs text-muted-foreground mt-1">Monthly impressions</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <p className="text-2xl font-bold">{creatorProfile.days_sponsored}</p>
              <p className="text-xs text-muted-foreground mt-1">Days sponsored</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <p className="text-2xl font-bold">€{creatorProfile.total_earned?.toLocaleString() || '0'}</p>
              <p className="text-xs text-muted-foreground mt-1">Total earned</p>
            </div>
          </div>
        )}

        {/* Creator profile edit */}
        {profile.role === 'creator' && editing && (
          <div className="rounded-2xl border border-border bg-card p-6 mb-6 space-y-4 animate-fade-up opacity-0-init delay-200">
            <h2 className="font-semibold">Creator details</h2>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="occupation">Occupation</Label>
                <Input id="occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="Software Developer" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Amsterdam, NL" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="followers">Followers</Label>
                <Input id="followers" value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="4.2K" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressions">Monthly impressions</Label>
                <Input id="impressions" value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="~18K monthly" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="audience">Audience description</Label>
              <Textarea
                id="audience"
                value={audienceDescription}
                onChange={(e) => setAudienceDescription(e.target.value)}
                placeholder="Describe your audience — who follows you, what they care about…"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Social links</Label>
              <div className="space-y-2">
                {socialLinks.map((link, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={link}
                      onChange={(e) => setSocialLinks((prev) => prev.map((l, idx) => idx === i ? e.target.value : l))}
                      placeholder="https://instagram.com/yourhandle"
                    />
                    {socialLinks.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setSocialLinks((prev) => prev.filter((_, idx) => idx !== i))}
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
                  onClick={() => setSocialLinks((prev) => [...prev, ''])}
                >
                  + Add link
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Social links display */}
        {profile.role === 'creator' && !editing && creatorProfile?.social_links && creatorProfile.social_links.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-6 mb-6 animate-fade-up opacity-0-init delay-300">
            <h2 className="font-semibold mb-4">Social links</h2>
            <div className="flex flex-wrap gap-3">
              {creatorProfile.social_links.filter(Boolean).map((link, i) => {
                const Icon = getSocialIcon(link);
                return (
                  <a
                    key={i}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-secondary hover:border-foreground/20 transition-all"
                  >
                    <Icon className="h-4 w-4" />
                    {link.replace(/https?:\/\//, '').split('/')[0]}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Account actions */}
        <div className="rounded-2xl border border-border bg-card p-6 animate-fade-up opacity-0-init delay-300">
          <h2 className="font-semibold mb-4">Account</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <p className="text-sm font-medium">Dashboard</p>
                <p className="text-xs text-muted-foreground">Go to your {profile.role} dashboard</p>
              </div>
              <Button variant="outline" size="sm" className="rounded-full" asChild>
                <Link href={dashboardHref}>
                  Open <ArrowLeft className="ml-2 h-3 w-3 rotate-180" />
                </Link>
              </Button>
            </div>

            {profile.role === 'admin' && (
              <div className="flex items-center justify-between py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-destructive" />
                  <div>
                    <p className="text-sm font-medium">Admin access</p>
                    <p className="text-xs text-muted-foreground">You have full platform access</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs text-destructive border-destructive/30">Admin</Badge>
              </div>
            )}

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">Sign out</p>
                <p className="text-xs text-muted-foreground">Sign out of your account on this device</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full text-destructive border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
