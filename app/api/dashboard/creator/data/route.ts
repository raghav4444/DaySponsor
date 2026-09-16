import { NextResponse } from 'next/server';
import { createAuthenticatedSupabaseClient } from '@/lib/supabase';

// Unified endpoint for creator dashboard data
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createAuthenticatedSupabaseClient(token);

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  if (!profileId) {
    return NextResponse.json({ error: 'Profile ID required' }, { status: 400 });
  }

  // Fetch days and sponsorships in parallel server-side
  const [daysRes, sponsorRes] = await Promise.all([
    supabase
      .from('days')
      .select('*, sponsorship_slots(*)')
      .eq('creator_id', profileId)
      .order('created_at', { ascending: false }),
    supabase
      .from('sponsorships')
      .select('*, profiles!sponsorships_brand_id_fkey(name, username)')
      .eq('creator_id', profileId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (daysRes.error || sponsorRes.error) {
    return NextResponse.json(
      { error: daysRes.error?.message || sponsorRes.error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    days: daysRes.data || [],
    sponsorships: sponsorRes.data || []
  });
}
