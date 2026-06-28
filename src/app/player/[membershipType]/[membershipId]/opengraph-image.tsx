import { ImageResponse } from 'next/og';
import { getPlayerOgData, MOST_FARMED_WINDOW_DAYS } from '@/lib/og/player-card';

// better-sqlite3 is a native Node module and cannot run on the edge runtime.
export const runtime = 'nodejs';
// Refresh the generated card at most hourly (Discord/Slack cache unfurls aggressively too).
export const revalidate = 3600;

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Destiny Farm Finder player card';

const ACCENT = '#f5c542';
const BG = '#0b0e14';
const PANEL = '#11151f';
const MUTED = '#8a93a6';

export default async function Image({
    params,
}: {
    params: Promise<{ membershipType: string; membershipId: string }>;
}) {
    const { membershipId } = await params;

    let data: ReturnType<typeof getPlayerOgData> = null;
    try {
        data = getPlayerOgData(membershipId);
    } catch {
        data = null;
    }

    const name = data?.displayName ?? 'Guardian';
    const totalClears = data?.totalClears ?? 0;
    const topRaidName = data?.topRaidName ?? null;
    const topRaidCount = data?.topRaidCount ?? 0;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: `radial-gradient(circle at 20% 0%, #1a2030 0%, ${BG} 55%)`,
                    padding: '64px 72px',
                    fontFamily: 'sans-serif',
                    color: '#ffffff',
                }}
            >
                {/* Wordmark */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div
                        style={{
                            width: '14px',
                            height: '44px',
                            background: ACCENT,
                            borderRadius: '4px',
                        }}
                    />
                    <div
                        style={{
                            fontSize: '30px',
                            fontWeight: 700,
                            letterSpacing: '0.18em',
                            color: ACCENT,
                        }}
                    >
                        DESTINY FARM FINDER
                    </div>
                </div>

                {/* Player name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '34px', color: MUTED }}>Guardian</div>
                    <div
                        style={{
                            fontSize: name.length > 22 ? '76px' : '96px',
                            fontWeight: 800,
                            lineHeight: 1.05,
                        }}
                    >
                        {name}
                    </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: '28px' }}>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            background: PANEL,
                            borderRadius: '18px',
                            border: '1px solid #1e2533',
                            padding: '28px 36px',
                        }}
                    >
                        <div style={{ fontSize: '88px', fontWeight: 800, color: ACCENT, lineHeight: 1 }}>
                            {totalClears.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '28px', color: MUTED, marginTop: '8px' }}>
                            total raid clears
                        </div>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            flex: 1,
                            background: PANEL,
                            borderRadius: '18px',
                            border: '1px solid #1e2533',
                            padding: '28px 36px',
                        }}
                    >
                        <div style={{ fontSize: '24px', color: MUTED }}>
                            {`Most farmed · last ${MOST_FARMED_WINDOW_DAYS} days`}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginTop: '10px' }}>
                            <div style={{ fontSize: '46px', fontWeight: 700, lineHeight: 1.1 }}>
                                {topRaidName ?? 'No recent clears'}
                            </div>
                            {topRaidName ? (
                                <div style={{ fontSize: '46px', fontWeight: 800, color: ACCENT }}>
                                    {`×${topRaidCount}`}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        ),
        { ...size }
    );
}
