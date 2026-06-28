import { ImageResponse } from 'next/og';
import { brandedCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og/branded-card';

export const runtime = 'nodejs';
export const revalidate = 3600;

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Destiny Farm Finder — real-time Destiny 2 raid tracking';

export default function Image() {
    return new ImageResponse(
        brandedCard({
            title: 'Real-time Destiny 2 raid tracking',
            subtitle: 'Live raid completion leaderboards and active fireteam sessions.',
        }),
        { ...size }
    );
}
