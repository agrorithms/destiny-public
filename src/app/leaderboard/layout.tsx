import type { Metadata } from 'next';

const title = 'Raid Leaderboard — Destiny Farm Finder';
const description =
    'Live Destiny 2 raid completion leaderboards. See who is farming the most clears right now.';

export const metadata: Metadata = {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
    return children;
}
