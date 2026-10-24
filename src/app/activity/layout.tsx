import type { Metadata } from 'next';

const title = 'Raid Activity — Destiny Farm Finder';
const description = 'How many Destiny 2 raids were in progress, hour by hour, over the last 7 days.';

export const metadata: Metadata = {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
};

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
    return children;
}
