import { NextResponse } from 'next/server';
import { getSystemStats } from '@/lib/system-stats';

export async function GET() {
    try {
        const stats = getSystemStats();
        return NextResponse.json({
            crawlerRunning: stats.crawlerRunning,
            crawlerStatus: stats.crawlerStatus,
            secondsSinceHeartbeat: stats.secondsSinceHeartbeat,
            scannerRunning: stats.scanner?.isRunning ?? false,
            scannerStatus: stats.scanner ? 'available' : 'unknown',
        });
    } catch (error) {
        console.error('[ERROR] Status query failed:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
