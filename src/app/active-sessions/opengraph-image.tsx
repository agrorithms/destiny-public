import { ImageResponse } from 'next/og';
import { brandedCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og/branded-card';
import { getActiveSessions } from '@/lib/db/queries';

export const runtime = 'nodejs';
// Live count — refresh more often than the static cards.
export const revalidate = 300;

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Destiny Farm Finder active raid sessions';

export default function Image() {
    let count = 0;
    try {
        count = getActiveSessions(undefined, 1000, true).length;
    } catch {
        count = 0;
    }

    return new ImageResponse(
        brandedCard({
            bigStat: count.toLocaleString(),
            bigStatLabel: count === 1 ? 'fireteam raiding now' : 'fireteams raiding now',
            title: 'Active Raid Sessions',
            subtitle: 'Live Destiny 2 fireteams currently running raids.',
        }),
        { ...size }
    );
}
