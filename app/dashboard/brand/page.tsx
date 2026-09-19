'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatMinorUnits } from '@/lib/money';
import { useToast } from '@/hooks/use-toast';
import { StatusBadge } from '@/components/auction/status-badge';
import {
  loadBrandBidSlots,
  loadBrandSponsorships,
  groupBidSlots,
  groupSponsorshipsByPhase,
  canOfferPayment,
  type BrandSlotRow,
  type BrandSponsorshipRow,
} from '@/lib/brand-dashboard-queries';
import type { AuctionBid } from '@/lib/auction-types';

type IconProps = React.SVGProps<SVGSVGElement>;

function Link({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

function Icon({ children, ...props }: IconProps & { children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

const Target = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></Icon>;
const DollarSign = (props: IconProps) => <Icon {...props}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7" /></Icon>;
const Package = (props: IconProps) => <Icon {...props}><path d="m16.5 9.4-9-5.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></Icon>;
const ArrowRight = (props: IconProps) => <Icon {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
const CheckCircle2 = (props: IconProps) => <Icon {...props}><path d="m9 12 2 2 4-4" /><circle cx="12" cy="12" r="9" /></Icon>;
const Gavel = (props: IconProps) => <Icon {...props}><path d="m14 13 7 7M3 21h18M6 18 18 6M4 8l4-4 4 4-4 4zM12 16l4-4 4 4-4 4z" /></Icon>;
const CreditCard = (props: IconProps) => <Icon {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></Icon>;
const AlertCircle = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></Icon>;
const Loader2 = (props: IconProps) => <Icon {...props}><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></Icon>;

type Tab = 'bids' | 'payment' | 'fulfillment' | 'ended';

/**
 * Brand dashboard.
 *
 * Two lifecycles are shown: the auctions the brand is bidding in, and the sponsorships
 * that resulted from a win. The sponsorship list keeps the fixed-price-era status flow
 * (pending → paid → shipped → review → completed) because that flow still describes
 * fulfillment; only the *price discovery* changed to bidding.
 *
 * "Pay now" appears only on a sponsorship this authenticated brand owns whose status is
 * still `pending`. The check is repeated server-side when the button is clicked, so a
 * stale browser row cannot create a checkout session for anyone else.
 */
export default function BrandDashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [bidSlots, setBidSlots] = useState<BrandSlotRow[]>([]);
  const [myBids, setMyBids] = useState<Map<string, AuctionBid>>(new Map());
  const [sponsorships, setSponsorships] = useState<BrandSponsorshipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('bids');
  const [payingFor, setPayingFor] = useState<string | null>(null);

  const load = useCallback(async (profileId: string) => {
    setLoading(true);
    const [bidResult, sponsorshipRows] = await Promise.all([
      loadBrandBidSlots(supabase, profileId),
      loadBrandSponsorships(supabase, profileId),
    ]);
    setBidSlots(bidResult.slots);
    setMyBids(bidResult.myBids);
    setSponsorships(sponsorshipRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (profile?.id) load(profile.id);
  }, [profile?.id, load]);

  const handlePayNow = useCallback(
    async (sponsorshipId: string) => {
      setPayingFor(sponsorshipId);
      try {
        const response = await fetch('/api/stripe/checkout/winning-bid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sponsorshipId }),
        });

        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };

        if (!response.ok || !payload.url) {
          toast({
            title: 'Could not start payment',
            description: payload.error ?? 'Please try again in a moment.',
            variant: 'destructive',
          });
          return;
        }

        // Redirect to Stripe; confirmation comes back through the webhook, not the URL.
        window.location.href = payload.url;
      } finally {
        setPayingFor(null);
      }
    },
    [toast],
  );

  if (authLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">Please sign in</p>
        <Link href="/login">
          <Button className="rounded-full">Sign in</Button>
        </Link>
      </div>
    );
  }

  if (profile?.role === 'creator') {
    return (
      <div className="min-h-screen pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-muted-foreground">This is the brand dashboard</p>
        <Link href="/dashboard/creator">
          <Button className="rounded-full">Go to creator dashboard</Button>
        </Link>
      </div>
    );
  }

  const bidGroups = groupBidSlots(bidSlots, myBids);
  const phases = groupSponsorshipsByPhase(sponsorships);

  const totalCommitted = sponsorships.reduce((sum, s) => sum + s.amount, 0);
  const totalFees = sponsorships.reduce((sum, s) => sum + s.platform_fee, 0);
  const outstanding = phases.paymentRequired.reduce((sum, s) => sum + s.amount, 0);
  const wonCount = bidGroups.won.length + phases.paid.length;

  const firstName = profile?.name?.split(' ')[0] || 'Brand';

  return (
    <div className="min-h-screen pt-20 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 animate-fade-up opacity-0-init">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Brand dashboard
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Good to see you, <span className="font-display italic">{firstName}</span>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Track your bids, payments and fulfillment
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild className="rounded-full">
              <Link href="/explore">
                <Target className="mr-2 h-4 w-4" />
                Find creators
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-up opacity-0-init delay-100">
          <StatCard
            label="Total committed"
            value={formatMinorUnits(totalCommitted, 'eur')}
            icon={DollarSign}
            color="text-accent"
            sub={`${formatMinorUnits(totalFees, 'eur')} platform fees`}
          />
          <StatCard
            label="Payment due"
            value={formatMinorUnits(outstanding, 'eur')}
            icon={CreditCard}
            color={outstanding > 0 ? 'text-amber-500' : 'text-muted-foreground'}
            sub={outstanding > 0 ? `${phases.paymentRequired.length} sponsorship${phases.paymentRequired.length === 1 ? '' : 's'}` : 'nothing due'}
          />
          <StatCard
            label="Won"
            value={String(wonCount)}
            icon={Gavel}
            color="text-blue-500"
            sub="auctions & sponsorships"
          />
          <StatCard
            label="Completed"
            value={String(phases.fulfillment.filter((s) => s.status === 'completed').length)}
            icon={CheckCircle2}
            color="text-accent"
            sub="with reviews"
          />
        </div>

        {outstanding > 0 && (
          <div
            className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-4 animate-fade-up opacity-0-init delay-150"
            data-testid="payment-required-banner"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10">
                <AlertCircle className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {formatMinorUnits(outstanding, 'eur')} payment required
                </p>
                <p className="text-xs text-muted-foreground">
                  Your slot is held until payment is confirmed by Stripe.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="rounded-full shrink-0 bg-amber-500 hover:bg-amber-600 text-white border-0"
              onClick={() => setTab('payment')}
            >
              Review payments
            </Button>
          </div>
        )}

        <div className="animate-fade-up opacity-0-init delay-200">
          <div className="flex items-center justify-between mb-4 overflow-x-auto">
            <div className="flex gap-1 p-1 rounded-lg bg-secondary">
              {(
                [
                  ['bids', `Active bids (${bidGroups.active.length})`],
                  ['payment', `Payment (${phases.paymentRequired.length})`],
                  ['fulfillment', `Fulfillment (${phases.paid.length})`],
                  ['ended', `Ended (${bidGroups.lost.length + phases.failed.length})`],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap',
                    tab === key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-2xl border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {tab === 'bids' && (
                <BidList
                  slots={bidGroups.active}
                  myBids={myBids}
                  emptyTitle="No active bids"
                  emptyBody="Find a creator and place a bid to get started."
                />
              )}

              {tab === 'payment' && (
                <PaymentList
                  rows={phases.paymentRequired}
                  onPay={handlePayNow}
                  payingFor={payingFor}
                />
              )}

              {tab === 'fulfillment' && (
                <FulfillmentList rows={[...phases.paid, ...phases.fulfillment]} />
              )}

              {tab === 'ended' && (
                <div className="space-y-6">
                  <BidList
                    slots={bidGroups.won}
                    myBids={myBids}
                    emptyTitle="No wins yet"
                    emptyBody="Won auctions appear here with their payment status."
                  />
                  {phases.failed.length > 0 && (
                    <FailedList rows={phases.failed} />
                  )}
                  <BidList
                    slots={bidGroups.lost}
                    myBids={myBids}
                    emptyTitle="Nothing here"
                    emptyBody="Auctions you did not win are listed for your records."
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className={cn('h-4 w-4', color)} />
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function DayCell({ slot }: { slot: BrandSlotRow }) {
  const day = slot.days;
  if (!day) return null;
  const dateStr = new Date(day.day_date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return (
    <>
      <p className="font-semibold truncate">{day.title}</p>
      <p className="text-sm text-muted-foreground">
        {dateStr} · {day.location}
      </p>
    </>
  );
}

function SponsorshipDayCell({ row }: { row: BrandSponsorshipRow }) {
  const day = row.days;
  const dateStr = day
    ? new Date(day.day_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  return (
    <>
      <p className="font-semibold truncate">{day?.title ?? 'Sponsorship'}</p>
      <p className="text-sm text-muted-foreground">
        @{row.profiles?.username || row.profiles?.name || 'creator'} · {dateStr}
      </p>
    </>
  );
}

/**
 * The active-bid list. Only the caller's own position is shown — never another brand's
 * identity or their bid history.
 */
function BidList({
  slots,
  myBids,
  emptyTitle,
  emptyBody,
}: {
  slots: BrandSlotRow[];
  myBids: Map<string, AuctionBid>;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (slots.length === 0) {
    return (
      <EmptyState
        icon={Gavel}
        title={emptyTitle}
        body={emptyBody}
        action={
          <Button asChild className="rounded-full">
            <Link href="/explore">
              Explore days <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {slots.map((slot) => {
        const myBid = myBids.get(slot.id);
        const currency = slot.currency ?? 'eur';
        const isWinning = myBid?.status === 'winner';

        return (
          <div
            key={slot.id}
            className="group rounded-2xl border border-border bg-card p-5 hover:border-foreground/20 transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <DayCell slot={slot} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {slot.tier} slot
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="font-bold text-lg">
                    {formatMinorUnits(Number(slot.current_highest_bid ?? 0), currency)}
                  </p>
                </div>
                <StatusBadge status={slot.auction_status} kind="auction" />
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
              {isWinning ? (
                <span
                  className="text-xs font-medium text-accent"
                  data-testid="winning-notice"
                >
                  You&apos;re the highest bidder
                </span>
              ) : myBid ? (
                <span className="text-xs text-muted-foreground" data-testid="outbid-notice">
                  Your bid:{' '}
                  {formatMinorUnits(Number(myBid.amount ?? 0), currency)} · outbid
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Bid placed</span>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/days/${slot.day_id}`}>View day</Link>
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The payment-required list. "Pay now" is offered only where `canOfferPayment` says the
 * row is unpaid and belongs to this brand; the click re-verifies on the server.
 */
function PaymentList({
  rows,
  onPay,
  payingFor,
}: {
  rows: BrandSponsorshipRow[];
  onPay: (sponsorshipId: string) => void;
  payingFor: string | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No payments due"
        body="Sponsorships you win will appear here until payment is confirmed."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const currency = row.currency ?? 'eur';
        const payable = canOfferPayment(row);
        const deadline = row.payment_due_at;
        const deadlineStr = deadline
          ? new Date(deadline).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : null;
        const isPaying = payingFor === row.id;

        return (
          <div
            key={row.id}
            className="rounded-2xl border border-amber-500/30 bg-card p-5"
            data-testid="payment-row"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <SponsorshipDayCell row={row} />
                {deadlineStr && (
                  <p className="text-xs text-amber-600 mt-1" data-testid="payment-deadline">
                    Payment due by {deadlineStr}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="font-bold text-lg">{formatMinorUnits(row.amount, currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    incl. {formatMinorUnits(row.platform_fee, currency)} fee
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-amber-500/20 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Payment is confirmed by Stripe, not by this page.
              </span>
              {payable && (
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => onPay(row.id)}
                  disabled={isPaying}
                  data-testid="pay-now-button"
                >
                  {isPaying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <CreditCard className="mr-1.5 h-4 w-4" />
                      Pay now
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Paid and beyond: shipping, fulfillment, review. */
function FulfillmentList({ rows }: { rows: BrandSponsorshipRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Nothing in fulfillment"
        body="Paid sponsorships move through shipping and review here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const currency = row.currency ?? 'eur';
        return (
          <div
            key={row.id}
            className="rounded-2xl border border-border bg-card p-5 hover:border-foreground/20 transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <SponsorshipDayCell row={row} />
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="font-bold text-lg">{formatMinorUnits(row.amount, currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    paid {formatMinorUnits(row.platform_fee, currency)} fee
                  </p>
                </div>
                <StatusBadge status={row.status} kind="sponsorship" />
              </div>
            </div>

            {row.status === 'review_pending' && (
              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <p className="text-xs text-amber-600 font-medium">
                  The creator&apos;s review is pending publication
                </p>
                <Button size="sm" variant="outline" className="rounded-full" asChild>
                  <Link href={`/dashboard/brand/campaigns/${row.id}`}>Details</Link>
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FailedList({ rows }: { rows: BrandSponsorshipRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const currency = row.currency ?? 'eur';
        return (
          <div
            key={row.id}
            className="rounded-2xl border border-border bg-card p-5 opacity-75"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <SponsorshipDayCell row={row} />
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="font-bold text-lg line-through">
                    {formatMinorUnits(row.amount, currency)}
                  </p>
                </div>
                <StatusBadge status={row.status} kind="sponsorship" />
              </div>
            </div>
            {row.payment_status === 'refunded' && (
              <p className="mt-3 text-xs text-muted-foreground">
                Refunded. {row.refund_amount ? formatMinorUnits(row.refund_amount, currency) + ' refunded' : ''}
                {row.stripe_refund_id ? ` · Ref: ${row.stripe_refund_id}` : ''}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Package;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary mx-auto mb-4">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="text-lg font-semibold mb-1">{title}</p>
      <p className="text-sm text-muted-foreground mb-6">{body}</p>
      {action}
    </div>
  );
}
