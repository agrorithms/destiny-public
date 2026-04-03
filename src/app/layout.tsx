import type { Metadata } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import './globals.css';
import PlayerSearch from '@/components/PlayerSearch';

export const metadata: Metadata = {
  title: 'Destiny Farm Finder',
  description: 'Real-time raid completion leaderboards and active session tracking for Destiny 2',
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
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-white">
        <nav className="border-b border-gray-200 bg-white/85 backdrop-blur-sm sticky top-0 z-50 dark:border-gray-800 dark:bg-gray-900/80">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/" className="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors shrink-0 dark:text-white dark:hover:text-blue-400">
              Destiny Farm Finder
            </Link>
            <PlayerSearch />
            <div className="flex gap-6 shrink-0">
              <Link
                href="/leaderboard"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-white"
              >
                Leaderboard
              </Link>
              <Link
                href="/active-sessions"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-white"
              >
                Active Sessions
              </Link>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
