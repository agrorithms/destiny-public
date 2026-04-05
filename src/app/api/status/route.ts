import { NextResponse } from 'next/server';
import { getSystemStats } from '@/lib/system-stats';

export async function GET() {
    try {
        const stats = getSystemStats();
        const stale = (stats.secondsSinceHeartbeat ?? 301) > 300; // 5 minutes

        return NextResponse.json(
            {
                crawlerRunning: stats.crawlerRunning,
                crawlerStatus: stats.crawlerStatus,
                secondsSinceHeartbeat: stats.secondsSinceHeartbeat,
                scannerRunning: stats.scanner?.isRunning ?? false,
                scannerStatus: stats.scanner ? 'available' : 'unknown',
                status: stale ? 'degraded' : 'ok',
                timestamp: Date.now()
            },
            { status: stale ? 503 : 200 }
        );
    } catch (error) {
        console.error('[ERROR] Status query failed:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
