import { NextRequest, NextResponse } from 'next/server';
import { runDiscovery } from '@/lib/discovery/snowball';
import { getAllRaidDefinitions } from '@/lib/bungie/manifest';
import { getBungieMaintenanceStatus } from '@/lib/bungie/maintenance';
import { withNoStore } from '@/lib/http/cache';

let discoveryInFlight: Promise<unknown> | null = null;

export async function POST(request: NextRequest) {
    let currentDiscovery: Promise<unknown> | null = null;

    try {
        const maintenance = getBungieMaintenanceStatus();
        if (maintenance.isVacuuming) {
            return withNoStore(NextResponse.json(
                { error: 'Database maintenance in progress, try again shortly' },
                { status: 503 }
            ));
        }

        const body = await request.json();

        const {
            seedPlayers,
            maxDepth = 2,
            maxPlayers = 500,
            hoursBack = 4,
            raidFilter,
        } = body;

        // Validate seed players
        if (!seedPlayers || !Array.isArray(seedPlayers) || seedPlayers.length === 0) {
            return withNoStore(NextResponse.json(
                {
                    error: 'seedPlayers is required and must be a non-empty array',
                    example: [{ membershipId: '4611686018469615924', membershipType: 3 }],
                },
                { status: 400 }
            ));
        }

        for (const player of seedPlayers) {
            if (!player.membershipId || !player.membershipType) {
                return withNoStore(NextResponse.json(
                    {
                        error: 'Each seed player must have membershipId and membershipType',
                        example: { membershipId: '4611686018469615924', membershipType: 3 },
                    },
                    { status: 400 }
                ));
            }
        }

        // Validate raid filter
        if (raidFilter) {
            const raids = getAllRaidDefinitions();
            if (!raids[raidFilter]) {
                return withNoStore(NextResponse.json(
                    { error: `Unknown raid key: ${raidFilter}`, validKeys: Object.keys(raids) },
                    { status: 400 }
                ));
            }
        }

        // Validate numeric params
        if (maxDepth < 1 || maxDepth > 5) {
            return withNoStore(NextResponse.json({ error: 'maxDepth must be between 1 and 5' }, { status: 400 }));
        }
        if (maxPlayers < 10 || maxPlayers > 5000) {
            return withNoStore(NextResponse.json({ error: 'maxPlayers must be between 10 and 5000' }, { status: 400 }));
        }
        if (hoursBack < 1 || hoursBack > 24) {
            return withNoStore(NextResponse.json({ error: 'hoursBack must be between 1 and 24' }, { status: 400 }));
        }

        if (discoveryInFlight) {
            return withNoStore(NextResponse.json(
                { error: 'Discovery is already running.' },
                { status: 409 }
            ));
        }

        console.log('[DISCOVERY] Triggered via API:', {
            seedCount: seedPlayers.length,
            maxDepth,
            maxPlayers,
            hoursBack,
            raidFilter,
        });

        const discoveryPromise = runDiscovery(seedPlayers, {
            maxDepth,
            maxPlayers,
            hoursBack,
            raidFilter,
        });
        discoveryInFlight = discoveryPromise;
        currentDiscovery = discoveryPromise;

        const result = await discoveryPromise;

        return withNoStore(NextResponse.json({
            success: true,
            result,
        }));
    } catch (error) {
        console.error('[ERROR] Discovery failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Discovery failed. Check server logs for details.' },
            { status: 500 }
        ));
    } finally {
        if (currentDiscovery && discoveryInFlight === currentDiscovery) {
            discoveryInFlight = null;
        }
    }
}
