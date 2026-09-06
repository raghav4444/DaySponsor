import Link from 'next/link';
import { Sparkles, Twitter, Github, Linkedin } from 'lucide-react';

export function Footer() {
  const columns = [
    {
      title: 'Platform',
      links: ['Explore', 'For Creators', 'For Brands', 'How it works', 'Pricing'],
    },
    {
      title: 'Company',
      links: ['About', 'Blog', 'Careers', 'Press', 'Contact'],
    },
    {
      title: 'Legal',
      links: ['Terms', 'Privacy', 'Trust & Safety', 'Review Policy', 'Cookie Policy'],
    },
  ];

  return (
    <footer className="border-t border-border/50 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-[1.5fr_1fr_1fr_1fr] gap-10">
          <div>
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
              {[Twitter, Github, Linkedin].map((Icon, i) => (
                <Link
                  key={i}
                  href="#"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-secondary transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold mb-4">{col.title}</h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link}>
                    <Link
                      href="#"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © 2026 DaySponsor. All rights reserved.
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
            <span>€18,420 paid to creators · 127 days sponsored</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
