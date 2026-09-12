import { ImageResponse } from 'next/og';
import { brandedCard, OG_SIZE, OG_CONTENT_TYPE, type CardStat } from '@/lib/og/branded-card';
import { getArchiveOverview } from '@/lib/db/archive/queries';

export const runtime = 'nodejs';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'The GoS 10k — 10,000 Garden of Salvation full clears';

// Rendered per request, not baked. The dataset is frozen so there is nothing to
// revalidate *for*, but `revalidate = false` would make this a static route and Next
// would generate it at build time — which is exactly the build-reads-the-Archive
// coupling ADR 0007 rejected, and would need the 63 MB file present in CI. The
// middleware cache header covers this path too, so it is served from cache in practice.
export const dynamic = 'force-dynamic';

export default function Image() {
    // Two failures are being traded off here, and they are not symmetric.
    //
    // A missing Archive must not take the unfurl down with it: a link that renders no card
    // at all is worse than one whose card is missing a number, and the page itself already
    // fails loudly (ADR 0007), so the failure is never silent overall.
    //
    // But the card must not *assert* figures it did not read. It used to fall back to the
    // published 10,000 / 5,455 on a throw, which means a missing, stale or wrong Archive
    // produced a confident, correct-looking card — the exact failure the Archive's whole
    // verify-on-open story exists to prevent, reproduced in the one artifact that gets
    // shared onward. So: read or say nothing. Never guess. (#95)
    let stats: CardStat[] | undefined;
    try {
        const overview = getArchiveOverview();
        stats = [
            { value: overview.pinnedFullClears.toLocaleString(), label: 'full clears' },
            { value: overview.helpers.toLocaleString(), label: 'guardians who helped' },
        ];
    } catch {
        // Card without figures. `brandedCard` omits the stat block entirely for undefined.
    }

    return new ImageResponse(
        brandedCard({
            subtitle: 'A complete archive of one Guardian’s Garden of Salvation history.',
            topTitle: 'The GoS 10k',
            stats,
        }),
        { ...size }
    );
}
