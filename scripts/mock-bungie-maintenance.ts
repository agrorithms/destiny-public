import http from 'http';
import { URL } from 'url';

type Phase = 'healthy' | 'disabled' | 'recovered';

const port = parseInt(process.env.MOCK_BUNGIE_PORT || '43111', 10);
const healthyMs = parseInt(process.env.MOCK_BUNGIE_HEALTHY_MS || '4000', 10);
const disabledMs = parseInt(process.env.MOCK_BUNGIE_DISABLED_MS || '9000', 10);
const recoveryMs = parseInt(process.env.MOCK_BUNGIE_RECOVERY_MS || '12000', 10);
const baseInstanceId = BigInt(process.env.MOCK_BUNGIE_BASE_INSTANCE_ID || '16795700000');
const specialCrawlerInstanceId = (baseInstanceId + BigInt(500000)).toString();
const raidHash = 3881495763; // Vault of Glass
const startTime = Date.now();

log(
    `Configured phases: healthy=${healthyMs}ms disabled=${disabledMs}ms recovery=${recoveryMs}ms`
);

function getPhase(now: number = Date.now()): Phase {
    const elapsed = now - startTime;
    if (elapsed < healthyMs) return 'healthy';
    if (elapsed < healthyMs + disabledMs) return 'disabled';
    return 'recovered';
}

function log(message: string): void {
    console.log(`[MOCK] ${message}`);
}

function bungieSuccess(response: unknown) {
    return {
        Response: response,
        ErrorCode: 1,
        ThrottleSeconds: 0,
        ErrorStatus: 'Success',
        Message: 'Ok',
        MessageData: {},
    };
}

function systemDisabled() {
    return {
        Response: {},
        ErrorCode: 5,
        ThrottleSeconds: 0,
        ErrorStatus: 'SystemDisabled',
        Message: 'This system is temporarily disabled for maintenance.',
        MessageData: {},
    };
}

function pgcrNotFound() {
    return {
        Response: {},
        ErrorCode: 1653,
        ThrottleSeconds: 0,
        ErrorStatus: 'DestinyPGCRNotFound',
        Message: 'No PGCR was found for the specified activity.',
        MessageData: {},
    };
}

function isoNow(offsetMs: number = 0): string {
    return new Date(Date.now() + offsetMs).toISOString();
}

function buildUserInfo(membershipType: number, membershipId: string) {
    return {
        membershipType,
        membershipId,
        displayName: `Mock${membershipId.slice(-4)}`,
        bungieGlobalDisplayName: `Mock${membershipId.slice(-4)}`,
        bungieGlobalDisplayNameCode: 1234,
    };
}

function buildPgcr(instanceId: string) {
    const membershipIdA = '4611686018469615924';
    const membershipIdB = '4611686018464222827';

    return bungieSuccess({
        period: isoNow(-60000),
        startingPhaseIndex: 0,
        activityWasStartedFromBeginning: true,
        activityDetails: {
            referenceId: raidHash,
            directorActivityHash: raidHash,
            instanceId,
            mode: 4,
            modes: [4],
        },
        entries: [
            {
                standing: 0,
                player: {
                    destinyUserInfo: {
                        ...buildUserInfo(1, membershipIdA),
                    },
                    characterClass: 'Titan',
                    characterLevel: 50,
                    lightLevel: 2020,
                },
                values: {
                    completed: { basic: { value: 1, displayValue: 'Yes' } },
                    kills: { basic: { value: 100, displayValue: '100' } },
                    deaths: { basic: { value: 5, displayValue: '5' } },
                    assists: { basic: { value: 20, displayValue: '20' } },
                    timePlayedSeconds: { basic: { value: 1800, displayValue: '1800' } },
                },
            },
            {
                standing: 0,
                player: {
                    destinyUserInfo: {
                        ...buildUserInfo(2, membershipIdB),
                    },
                    characterClass: 'Warlock',
                    characterLevel: 50,
                    lightLevel: 2018,
                },
                values: {
                    completed: { basic: { value: 1, displayValue: 'Yes' } },
                    kills: { basic: { value: 90, displayValue: '90' } },
                    deaths: { basic: { value: 4, displayValue: '4' } },
                    assists: { basic: { value: 30, displayValue: '30' } },
                    timePlayedSeconds: { basic: { value: 1800, displayValue: '1800' } },
                },
            },
        ],
    });
}

function buildProfile(membershipType: number, membershipId: string, includeActivities: boolean) {
    const characterId = `${membershipId.slice(-6)}0001`;
    const profile: Record<string, unknown> = {
        profile: {
            data: {
                userInfo: buildUserInfo(membershipType, membershipId),
                characterIds: [characterId],
            },
        },
    };

    if (includeActivities) {
        profile.profileTransitoryData = {
            data: {
                partyMembers: [
                    {
                        membershipId,
                        emblemHash: 0,
                        displayName: `Mock${membershipId.slice(-4)}`,
                        status: 1,
                    },
                ],
                currentActivity: {
                    startTime: isoNow(-180000),
                    endTime: isoNow(3600000),
                    score: 0,
                    highestOpposingFactionScore: 0,
                    numberOfOpponents: 0,
                    numberOfPlayers: 1,
                    currentActivityHash: raidHash,
                    currentActivityModeHash: 4,
                    currentActivityModeType: 4,
                    currentPlaylistActivityHash: raidHash,
                },
                joinability: {
                    openSlots: 2,
                    privacySetting: 0,
                    closedReasons: 0,
                },
            },
        };
        profile.characterActivities = {
            data: {
                [characterId]: {
                    currentActivityHash: raidHash,
                    currentActivityModeHash: 4,
                    currentActivityModeType: 4,
                    dateActivityStarted: isoNow(-180000),
                },
            },
        };
    }

    return bungieSuccess(profile);
}

function buildActivityHistory(membershipType: number, membershipId: string, characterId: string) {
    return bungieSuccess({
        activities: [
            {
                period: isoNow(-60000),
                activityDetails: {
                    referenceId: raidHash,
                    instanceId: specialCrawlerInstanceId,
                    mode: 4,
                    modes: [4],
                    directorActivityHash: raidHash,
                },
                values: {},
            },
        ],
        membershipType,
        membershipId,
        characterId,
    });
}

const phaseLogTimers = [
    { at: 0, label: 'healthy' },
    { at: healthyMs, label: 'disabled' },
    { at: healthyMs + disabledMs, label: 'recovered' },
];

for (const timer of phaseLogTimers) {
    setTimeout(() => {
        log(`Phase changed to ${timer.label}`);
    }, timer.at);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const phase = getPhase();

    const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
    };

    if (req.method !== 'GET' && req.method !== 'POST') {
        send(405, { error: 'Method not allowed' });
        return;
    }

    if (phase === 'disabled') {
        send(200, systemDisabled());
        return;
    }

    const pgcrMatch = url.pathname.match(/\/Platform\/Destiny2\/Stats\/PostGameCarnageReport\/(\d+)\/$/);
    if (pgcrMatch) {
        const instanceId = pgcrMatch[1];
        if (instanceId === specialCrawlerInstanceId) {
            send(200, buildPgcr(instanceId));
            return;
        }

        if (phase === 'healthy') {
            send(200, pgcrNotFound());
            return;
        }

        const numericId = BigInt(instanceId);
        if (numericId >= baseInstanceId + BigInt(1) && numericId <= baseInstanceId + BigInt(20)) {
            send(200, buildPgcr(instanceId));
            return;
        }

        send(200, pgcrNotFound());
        return;
    }

    const profileMatch = url.pathname.match(/\/Platform\/Destiny2\/(\d+)\/Profile\/(\d+)\/$/);
    if (profileMatch) {
        const membershipType = parseInt(profileMatch[1], 10);
        const membershipId = profileMatch[2];
        const components = new Set((url.searchParams.get('components') || '').split(',').filter(Boolean));
        const includeActivities = components.has('204') || components.has('1000');
        send(200, buildProfile(membershipType, membershipId, includeActivities));
        return;
    }

    const historyMatch = url.pathname.match(/\/Platform\/Destiny2\/(\d+)\/Account\/(\d+)\/Character\/(\d+)\/Stats\/Activities\/$/);
    if (historyMatch) {
        const membershipType = parseInt(historyMatch[1], 10);
        const membershipId = historyMatch[2];
        const characterId = historyMatch[3];
        send(200, buildActivityHistory(membershipType, membershipId, characterId));
        return;
    }

    send(404, { error: `Unhandled route for ${url.pathname}` });
});

server.listen(port, '127.0.0.1', () => {
    log(`Listening on http://127.0.0.1:${port}`);
    log(`Using base instance id ${baseInstanceId.toString()} and crawler instance ${specialCrawlerInstanceId}`);
});

process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
