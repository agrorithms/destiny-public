import type { ReactElement } from 'react';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const ACCENT = '#f5c542';
const BG = '#0b0e14';
const MUTED = '#8a93a6';

interface BrandedCardOptions {
    title: string;
    subtitle: string;
    /** Optional big highlighted number (e.g. live session count). */
    bigStat?: string;
    bigStatLabel?: string;
}

/**
 * Shared OG card frame for non per-player pages (homepage, leaderboard, active sessions).
 * Returns a `next/og`-compatible JSX tree (flexbox-only styling).
 */
export function brandedCard({ title, subtitle, bigStat, bigStatLabel }: BrandedCardOptions): ReactElement {
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                background: `radial-gradient(circle at 20% 0%, #1a2030 0%, ${BG} 55%)`,
                padding: '72px',
                fontFamily: 'sans-serif',
                color: '#ffffff',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '14px', height: '44px', background: ACCENT, borderRadius: '4px' }} />
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {bigStat ? (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '24px' }}>
                        <div style={{ fontSize: '120px', fontWeight: 800, color: ACCENT, lineHeight: 1 }}>
                            {bigStat}
                        </div>
                        {bigStatLabel ? (
                            <div style={{ fontSize: '36px', color: MUTED }}>{bigStatLabel}</div>
                        ) : null}
                    </div>
                ) : null}
                <div style={{ fontSize: '72px', fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
                <div style={{ fontSize: '34px', color: MUTED }}>{subtitle}</div>
            </div>
        </div>
    );
}
