'use client';

import { startTransition, useOptimistic } from 'react';
import { useRouter } from 'next/navigation';
import RaidMultiSelect from '@/components/RaidMultiSelect';
import { MAX_RAIDS } from './activity-raids';
import { activityRangeHref, type ActivityRangeId } from './activity-range';

/**
 * The raid picker above the Raid Activity chart's bottom panel (#198): the site's raid
 * multi-select, capped at {@link MAX_RAIDS}. The picked raids live in the URL (`?raids=`), as
 * the range does, so a pick is a navigation — `router.replace`, so a run of picks leaves one
 * history entry — and the server component draws the panel from the new URL.
 *
 * **Shows what is drawn, not what was clicked.** While the navigation is in flight it shows
 * the reader's own pick, so a click answers at once; once the page arrives it shows the raids
 * the server drew. That matters when the two differ: unpicking the last raid writes a link
 * with no `raids`, and the server answers with the range's top raids, which the picker then
 * shows ticked.
 *
 * With JavaScript off this is inert, as the site's other client-side filters are; the raids
 * in the URL are still drawn.
 */
export function ActivityRaidPicker({
    raids,
    picked,
    range,
}: {
    raids: Array<{ key: string; name: string }>;
    picked: string[];
    range: ActivityRangeId;
}) {
    const router = useRouter();
    // The reader's pick while the navigation is in flight, then the server's `picked` again.
    const [shown, setShown] = useOptimistic(picked);

    function pick(next: string[]) {
        startTransition(() => {
            setShown(next);
            router.replace(activityRangeHref(range, next), { scroll: false });
        });
    }

    return (
        <div data-testid="activity-raid-picker" className="max-w-full">
            <label className="block text-xs ui-text-muted mb-1">Raids</label>
            <RaidMultiSelect
                raids={raids}
                selected={shown}
                onChange={pick}
                maxSelected={MAX_RAIDS}
                limitMessage="Pick up to five raids — remove one to add another."
            />
        </div>
    );
}
