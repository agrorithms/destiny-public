export const ACTIVITY_RANGES = [
    { id: '24h', label: '24h', rangeSeconds: 0, stepSeconds: 0, step: '', span: '' },
    { id: '7d', label: '7d', rangeSeconds: 0, stepSeconds: 0, step: '', span: '' },
    { id: '30d', label: '30d', rangeSeconds: 0, stepSeconds: 0, step: '', span: '' },
] as const;

export type ActivityRange = (typeof ACTIVITY_RANGES)[number];
export type ActivityRangeId = ActivityRange['id'];

export function parseActivityRange(searchParams: Record<string, string | string[] | undefined>): ActivityRange {
    void searchParams;
    throw new Error('not implemented');
}

export function activityRangeHref(id: ActivityRangeId): string {
    void id;
    throw new Error('not implemented');
}
