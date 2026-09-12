import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  metadataBase: new URL('https://daysponsor.app'),
  title: 'DaySponsor — Let brands sponsor your day',
  description:
    'Creators open their real lives to brands. Brands get real-world product experiences. Sponsored placement, honest reviews.',
  openGraph: {
    title: 'DaySponsor — Let brands sponsor your day',
    description:
      'Use their product. Tell the truth. Get paid. The marketplace where brands sponsor real creator experiences.',
    images: [{ url: '/og.png' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: '/og.png' }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
