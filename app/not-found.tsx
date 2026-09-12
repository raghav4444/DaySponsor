import Link from 'next/link';
import { Navbar } from '@/components/site/navbar';
import { Footer } from '@/components/site/footer';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4">404</p>
        <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight mb-4">
          Page not found
        </h1>
        <p className="text-lg text-muted-foreground max-w-md mb-10">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button asChild className="rounded-full">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to home
            </Link>
          </Button>
          <Button variant="outline" className="rounded-full" asChild>
            <Link href="/explore">Explore days</Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
