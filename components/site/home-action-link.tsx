'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

type HomeActionLinkProps = {
  children: React.ReactNode;
  className?: string;
};

export function HomeActionLink({ children, className }: HomeActionLinkProps) {
  const { user, profile, loading } = useAuth();
  const href = !user
    ? '/signup'
    : profile?.role === 'brand'
      ? '/dashboard/brand'
      : '/dashboard/creator/days/new';

  return (
    <Link
      href={href}
      className={className}
      aria-disabled={loading}
      onClick={(event) => {
        if (loading) event.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}