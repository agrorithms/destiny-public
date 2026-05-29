import { NextResponse } from 'next/server';
import { getAllRaidDefinitions } from '@/lib/bungie/manifest';
import { withCache } from '@/lib/http/cache';

export async function GET() {
    const raids = getAllRaidDefinitions();

    const raidList = Object.entries(raids).map(([key, raid]) => ({
        key,
        name: raid.name,
        slug: raid.slug,
    }));

    return withCache(NextResponse.json({
        raids: raidList,
    }), 86_400, 604_800);
}
