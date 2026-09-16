'use client';

import { useState } from 'react';
import { Gavel, Loader2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCountdown } from '@/hooks/use-countdown';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { formatMinorUnits, minimumNextBid, parseMajorUnitsToMinor } from '@/lib/money';
import { StatusBadge } from '@/components/auction/status-badge';
import { cn } from '@/lib/utils';
import type { SlotWithAuction } from '@/lib/auction-queries';

/**
 * The bidding panel shown for an open slot on a day page.
 *
 * What it deliberately does *not* do: declare a winner, set a status, or trust any local
 * amount. The bid is submitted to the atomic RPC, and every visible state comes from the
 * server's reply. Losing bidders are never identified — only the caller's own position.
 */

type AuctionPanelProps = {
  slot: SlotWithAuction;
  /** Called with the major-unit string the user typed. Parent validates it too. */
  onSubmitBid: (slotId: string, amountMinorUnits: number) => Promise<BidOutcome>;
  /** Called when the countdown hits zero, so the parent refetches. */
  onAuctionElapsed: () => void;
  /** When true this is the creator's own day, so bidding is hidden. */
  isOwnDay: boolean;
  className?: string;
};

export type BidOutcome = {
  ok: boolean;
  /** The current highest bid after the attempt, straight from the server. */
  currentHighestBid?: number;
  message?: string;
};

export function AuctionPanel({
  slot,
  onSubmitBid,
  onAuctionElapsed,
  isOwnDay,
  className,
}: AuctionPanelProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<BidOutcome | null>(null);

  const countdown = useCountdown(slot.auction_ends_at, onAuctionElapsed);

  const currency = slot.currency ?? 'eur';
  const startingBid = Number(slot.starting_price ?? 0);
  const highest = Number(slot.current_highest_bid ?? 0);
  const bidCount = Number(slot.bid_count ?? 0);
  const isOpen = slot.auction_status === 'open' && !countdown.elapsed;

  // "Am I winning" is derived from the caller's own bid row, never from a list of bidders.
  const isWinning = Boolean(slot.is_winning);
  const myBid = slot.my_bid?.amount ?? null;

  // The minimum acceptable bid is computed for display only; the RPC re-checks it.
  const minNextBid = minimumNextBid(highest, startingBid);
  const minNextBidLabel = formatMinorUnits(minNextBid, currency);

  const handleBid = async () => {
    const parsed = parseMajorUnitsToMinor(amount);
    if (parsed === null) {
      toast({
        title: 'Enter a bid amount',
        description: 'Use a number like 450 or 4.50.',
        variant: 'destructive',
      });
      return;
    }

    if (parsed < minNextBid) {
      toast({
        title: 'Bid too low',
        description: `The minimum bid is ${minNextBidLabel}.`,
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSubmitBid(slot.id, parsed);
      setOutcome(result);

      if (result.ok) {
        setAmount('');
        toast({
          title: 'Bid placed',
          description: `You're the highest bidder at ${formatMinorUnits(
            result.currentHighestBid ?? parsed,
            currency,
          )}.`,
        });
      } else {
        // A conflict means the server knows the real current bid — show it.
        toast({
          title: 'Outbid',
          description:
            result.message ??
            'Someone placed a higher bid. The current bid has been updated.',
          variant: 'destructive',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // --- ended / closed states ----------------------------------------------
  if (!isOpen) {
    return (
      <ClosedSlotSummary
        slot={slot}
        isWinning={isWinning}
        myBid={myBid}
        currency={currency}
        className={className}
      />
    );
  }

  if (isOwnDay) {
    return (
      <div className={cn('rounded-xl border border-border/50 p-4', className)}>
        <p className="text-xs text-muted-foreground">This is your day — bidding is closed for you.</p>
      </div>
    );
  }

  if (profile?.role !== 'brand') {
    return (
      <div className={cn('rounded-xl border p-4 space-y-3', className)}>
        <SlotHeader slot={slot} countdownLabel={countdown.label} />
        <BidFacts
          currency={currency}
          startingBid={startingBid}
          highest={highest}
          bidCount={bidCount}
        />
        <p className="text-xs text-muted-foreground">
          {profile ? 'Switch to a brand account to bid.' : 'Sign in as a brand to place a bid.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-border p-4 space-y-4', className)}>
      <SlotHeader slot={slot} countdownLabel={countdown.label} urgent={countdown.urgent} />

      {isWinning && (
        <p className="text-sm font-medium text-accent" data-testid="winning-notice">
          You&apos;re currently winning at {formatMinorUnits(myBid ?? highest, currency)}
        </p>
      )}
      {!isWinning && myBid !== null && (
        <p className="text-sm font-medium text-amber-600" data-testid="outbid-notice">
          You&apos;ve been outbid. Current bid:{' '}
          {formatMinorUnits(highest, currency)}
        </p>
      )}

      <BidFacts
        currency={currency}
        startingBid={startingBid}
        highest={highest}
        bidCount={bidCount}
      />

      {slot.description && (
        <p className="text-xs text-muted-foreground">{slot.description}</p>
      )}

      <div className="space-y-2">
        <label htmlFor={`bid-${slot.id}`} className="sr-only">
          Your bid for the {slot.tier} slot
        </label>
        <div className="flex gap-2">
          <Input
            id={`bid-${slot.id}`}
            type="text"
            inputMode="decimal"
            placeholder={minNextBidLabel}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setOutcome(null);
            }}
            disabled={submitting}
            data-testid="bid-input"
            aria-describedby={`bid-help-${slot.id}`}
          />
          <Button
            onClick={handleBid}
            disabled={submitting}
            className="rounded-full shrink-0"
            data-testid="place-bid-button"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Gavel className="h-4 w-4 mr-1.5" />
                Place bid
              </>
            )}
          </Button>
        </div>
        <p id={`bid-help-${slot.id}`} className="text-xs text-muted-foreground">
          Minimum bid: {minNextBidLabel}
        </p>
      </div>

      {outcome && !outcome.ok && outcome.message && (
        <p className="text-xs text-destructive" data-testid="bid-error">
          {outcome.message}
        </p>
      )}
    </div>
  );
}

function SlotHeader({
  slot,
  countdownLabel,
  urgent,
}: {
  slot: SlotWithAuction;
  countdownLabel: string;
  urgent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <span className="font-semibold">{slot.tier} Sponsor</span>
        <StatusBadge status={slot.auction_status} kind="auction" />
      </span>
      <span
        className={cn(
          'text-xs font-medium tabular-nums',
          urgent ? 'text-destructive' : 'text-muted-foreground',
        )}
        data-testid="auction-countdown"
        aria-live="polite"
      >
        {countdownLabel}
      </span>
    </div>
  );
}

function BidFacts({
  currency,
  startingBid,
  highest,
  bidCount,
}: {
  currency: string;
  startingBid: number;
  highest: number;
  bidCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-lg bg-secondary/50 py-2 px-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Starting</p>
        <p className="text-sm font-semibold">{formatMinorUnits(startingBid, currency)}</p>
      </div>
      <div className="rounded-lg bg-secondary/50 py-2 px-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</p>
        <p className="text-sm font-semibold flex items-center justify-center gap-1">
          <TrendingUp className="h-3 w-3" />
          {formatMinorUnits(highest, currency)}
        </p>
      </div>
      <div className="rounded-lg bg-secondary/50 py-2 px-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Bids</p>
        <p className="text-sm font-semibold">{bidCount}</p>
      </div>
    </div>
  );
}

function ClosedSlotSummary({
  slot,
  isWinning,
  myBid,
  currency,
  className,
}: {
  slot: SlotWithAuction;
  isWinning: boolean;
  myBid: number | null;
  currency: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border/50 p-4 space-y-2', className)}>
      <SlotHeader slot={slot} countdownLabel="Auction ended" />
      <BidFacts
        currency={currency}
        startingBid={Number(slot.starting_price ?? 0)}
        highest={Number(slot.current_highest_bid ?? 0)}
        bidCount={Number(slot.bid_count ?? 0)}
      />
      {isWinning ? (
        <p className="text-sm font-medium text-accent" data-testid="won-notice">
          You won this slot. Payment is required.
        </p>
      ) : myBid !== null ? (
        <p className="text-sm text-muted-foreground" data-testid="lost-notice">
          You did not win this slot.
        </p>
      ) : null}
      {slot.auction_status === 'awaiting_payment' && isWinning && (
        <PaymentRequiredNotice />
      )}
    </div>
  );
}

function PaymentRequiredNotice() {
  return (
    <p className="text-sm font-medium text-amber-600" data-testid="payment-required-notice">
      Payment required
    </p>
  );
}
