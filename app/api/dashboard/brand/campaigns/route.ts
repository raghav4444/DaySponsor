import { NextResponse } from 'next/server';
import { createAuthenticatedSupabaseClient } from '@/lib/supabase';

// Get campaigns for a brand (sponsorships linked to them)
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createAuthenticatedSupabaseClient(token);

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');

  if (!brandId) {
    return NextResponse.json({ error: 'Brand ID required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('sponsorships')
    .select(`
      *,
      slot:sponsorship_slots(day:days(title, category))
    `)
    .eq('brand_id', brandId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: data });
}
