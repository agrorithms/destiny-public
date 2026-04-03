'use client';

import { useEffect, useState } from 'react';

interface Stats {
    crawlerRunning: boolean;
    crawlerStatus: string;
    secondsSinceHeartbeat: number | null;
    scannerRunning: boolean;
    scannerStatus: string;
}

function formatSecondsAgo(seconds: number | null): string {
    if (seconds === null) return 'never';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
}

export default function StatsBar() {
    const [stats, setStats] = useState<Stats | null>(null);

    useEffect(() => {
        const fetchStats = () => {
            fetch('/api/status')
                .then((res) => res.json())
                .then(setStats)
                .catch((err) => console.error('Failed to fetch stats:', err));
        };

        fetchStats();
        const interval = setInterval(fetchStats, 15000);
        return () => clearInterval(interval);
    }, []);

    if (!stats) {
        return (
            <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        );
    }

    return (
        <div className="flex items-center gap-4 text-xs text-gray-600 bg-white/80 border border-gray-200 rounded-lg px-4 py-2 dark:text-gray-400 dark:bg-gray-800/50 dark:border-gray-700">
            <div className="flex items-center gap-2">
                <span>Scanner</span>
                <div
                    className={`w-2 h-2 rounded-full ${stats.scannerRunning ? 'bg-blue-500 animate-pulse' : 'bg-red-500'
                        }`}
                    title={`Scanner ${stats.scannerRunning ? 'running' : stats.scannerStatus === 'unknown' ? 'unknown' : 'stopped'}`}
                />
            </div>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <div className="flex items-center gap-2">
                <span>Crawler</span>
                <div
                    className={`w-2 h-2 rounded-full ${stats.crawlerRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                        }`}
                    title={`Crawler ${stats.crawlerRunning ? 'running' : stats.crawlerStatus === 'never_started' ? 'never started' : 'stopped'}${stats.secondsSinceHeartbeat !== null ? ` (${formatSecondsAgo(stats.secondsSinceHeartbeat)})` : ''}`}
                />
            </div>
        </div>
    );
}
