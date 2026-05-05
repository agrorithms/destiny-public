import type { Metadata } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import './globals.css';
import PlayerSearch from '@/components/PlayerSearch';
import BungieMaintenanceAlert from '@/components/BungieMaintenanceAlert';

export const metadata: Metadata = {
  title: 'Destiny Farm Finder',
  description: 'Real-time raid completion leaderboards and active session tracking for Destiny 2',
  manifest: '/manifest.json',
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://cloud.umami.is/script.js"
          data-website-id="ac99ded7-08b1-405d-9438-b3e03c1a7339"
          strategy="afterInteractive"
        />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"></link>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"></link>
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"></link>
        <link rel="manifest" href="/manifest.json"></link>
      </head>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <nav className="ui-nav-surface border-b backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/" className="text-lg font-bold ui-text-primary hover:text-[var(--ui-accent)] transition-colors shrink-0">
              Destiny Farm Finder
            </Link>
            <PlayerSearch />
            <div className="flex gap-6 shrink-0">
              <Link
                href="/leaderboard"
                className="text-sm ui-text-secondary hover:text-[var(--ui-text-primary)] transition-colors"
              >
                Leaderboard
              </Link>
              <Link
                href="/active-sessions"
                className="text-sm ui-text-secondary hover:text-[var(--ui-text-primary)] transition-colors"
              >
                Active Sessions
              </Link>
            </div>
          </div>
        </nav>
        <BungieMaintenanceAlert />
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
