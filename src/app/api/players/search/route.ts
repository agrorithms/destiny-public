import { NextRequest, NextResponse } from 'next/server';
import { formatBungieDisplayName, searchPlayersByName } from '@/lib/db/queries';
import type { PlayerSearchResult } from '@/lib/db/queries';
import { parseQuery } from '@/lib/bungie/search-mapping';
import { withNoStore } from '@/lib/http/cache';

interface SearchResponseResult {
    membershipId: string;
    membershipType: number;
    displayName: string;
    baseName: string;
    secondaryDisplayName: string;
    isExactFullMatch: boolean;
    isExactNameMatch: boolean;
}

function formatResults(query: string, localResults: PlayerSearchResult[]): SearchResponseResult[] {
    const lowerQuery = query.toLowerCase();
    const nameOnly = parseQuery(query).baseName.toLowerCase();

    return localResults.map((row) => {
        const baseName = row.bungieGlobalDisplayName || row.displayName || '';
        const fullName = formatBungieDisplayName(row);
        const secondaryDisplayName = row.displayName || row.membershipId;

        return {
            membershipId: row.membershipId,
            membershipType: row.membershipType,
            displayName: fullName,
            baseName,
            secondaryDisplayName,
            isExactFullMatch: fullName.toLowerCase() === lowerQuery,
            isExactNameMatch: baseName.toLowerCase() === nameOnly,
        };
    });
}

// Local SQLite search only. The Bungie name-search fallback now runs client-side
// (see src/lib/bungie/client-api.ts) so user search traffic never consumes the
// server's Bungie API budget.
export async function GET(request: NextRequest) {
    const query = (request.nextUrl.searchParams.get('query') || '').trim();
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '8', 10), 1), 20);

    if (query.length < 2) {
        return withNoStore(NextResponse.json({ query, results: [] }));
    }

    try {
        const localResults = searchPlayersByName(query, limit);
        const results = formatResults(query, localResults);

        return withNoStore(NextResponse.json({ query, results }));
    } catch (error) {
        console.error('[ERROR] Player search failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
