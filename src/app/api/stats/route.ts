import { NextResponse } from 'next/server';
import { getSystemStats } from '@/lib/system-stats';

export async function GET() {
    try {
        return NextResponse.json(getSystemStats());
    } catch (error) {
        console.error('[ERROR] Stats query failed:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
