import Link from 'next/link';
import { Sparkles, Twitter, Github, Linkedin } from 'lucide-react';

export function Footer() {
  const columns = [
    {
      title: 'Platform',
      links: [
        { label: 'Explore', href: '/explore' },
        { label: 'For Creators', href: '/#creators' },
        { label: 'For Brands', href: '/#brands' },
        { label: 'How it works', href: '/#how-it-works' },
        { label: 'Pricing', href: '/pricing' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'About', href: '/about' },
        { label: 'Blog', href: '/blog' },
        { label: 'Careers', href: '/careers' },
        { label: 'Press', href: '/press' },
        { label: 'Contact', href: '/contact' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Terms', href: '/terms' },
        { label: 'Privacy', href: '/privacy' },
        { label: 'Trust & Safety', href: '/trust-safety' },
        { label: 'Review Policy', href: '/review-policy' },
        { label: 'Cookie Policy', href: '/cookie-policy' },
      ],
    },
  ];

  return (
    <footer className="border-t border-border/50 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-10">
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="text-lg font-semibold tracking-tight">DaySponsor</span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              The marketplace where brands sponsor real creator experiences.
              Use their product. Tell the truth. Get paid.
            </p>
            <div className="flex gap-3 mt-6">
              {[
                { Icon: Twitter, href: 'https://x.com/daysponsor', label: 'DaySponsor on X' },
                { Icon: Github, href: 'https://github.com/raghav4444/DaySponsor', label: 'DaySponsor on GitHub' },
                { Icon: Linkedin, href: 'https://www.linkedin.com/company/daysponsor', label: 'DaySponsor on LinkedIn' },
              ].map(({ Icon, href, label }) => (
                <Link
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-secondary transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title} className="col-span-1">
              <h4 className="text-sm font-semibold mb-4">{col.title}</h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border/50 pt-6 text-center sm:mt-12 sm:flex-row sm:gap-4 sm:pt-8 sm:text-left">
          <p className="text-xs leading-relaxed text-muted-foreground">
            © 2026 DaySponsor. All rights reserved.
          </p>
          <div className="flex items-center gap-2 text-center text-xs text-muted-foreground">
            <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
            <span>€18,420 paid to creators · 127 days sponsored</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
