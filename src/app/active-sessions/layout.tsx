import type { Metadata } from 'next';

const title = 'Active Raid Sessions — Destiny Farm Finder';
const description = 'Live Destiny 2 fireteams currently running raids, tracked in real time.';

export const metadata: Metadata = {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
};

export default function ActiveSessionsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
