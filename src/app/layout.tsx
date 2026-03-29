import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import PlayerSearch from '@/components/PlayerSearch';
import BungieAuthBadge from '@/components/BungieAuthBadge';

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
      <body className="bg-gray-900 text-white min-h-screen">
        <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Link href="/" className="text-lg font-bold text-white hover:text-blue-400 transition-colors shrink-0">
                Destiny Farm Finder
              </Link>
              <div className="flex items-center gap-3">
                <PlayerSearch />
                <BungieAuthBadge />
              </div>
            </div>
            <div className="flex gap-6 shrink-0">
              <Link
                href="/leaderboard"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Leaderboard
              </Link>
              <Link
                href="/active-sessions"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Active Sessions
              </Link>
              <Link
                href="/fireteam-finder"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Fireteam Finder
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
