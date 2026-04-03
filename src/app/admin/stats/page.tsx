import { getSystemStats } from '@/lib/system-stats';

export const dynamic = 'force-dynamic';

function formatSecondsAgo(seconds: number | null): string {
    if (seconds === null) return 'never';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

export default async function AdminStatsPage() {
    const stats = getSystemStats();

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
            <h1 className="text-3xl font-bold text-white">Admin Stats</h1>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-300">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span>Scanner</span>
                        <div
                            className={`w-2 h-2 rounded-full ${stats.scanner?.isRunning ? 'bg-blue-500 animate-pulse' : 'bg-red-500'
                                }`}
                        />
                        <span>{stats.scanner?.isRunning ? 'Running' : 'Stopped'}</span>
                    </div>
                    <span className="text-gray-600">|</span>
                    <div className="flex items-center gap-2">
                        <span>Crawler</span>
                        <div
                            className={`w-2 h-2 rounded-full ${stats.crawlerRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                                }`}
                        />
                        <span>
                            {stats.crawlerRunning
                                ? 'Running'
                                : stats.crawlerStatus === 'never_started'
                                    ? 'Never Started'
                                    : 'Stopped'}
                        </span>
                        <span className="text-gray-500">({formatSecondsAgo(stats.secondsSinceHeartbeat)})</span>
                    </div>
                </div>
            </div>

            <section className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <h2 className="text-lg font-semibold text-white mb-3">Database</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="text-gray-400">Players: <span className="text-gray-200">{stats.database.totalPlayers.toLocaleString()}</span></div>
                    <div className="text-gray-400">PGCRs: <span className="text-gray-200">{stats.database.totalPGCRs.toLocaleString()}</span></div>
                    <div className="text-gray-400">PGCR Entries: <span className="text-gray-200">{stats.database.totalPGCRPlayers.toLocaleString()}</span></div>
                    <div className="text-gray-400">Active Sessions: <span className="text-gray-200">{stats.database.activeSessions.toLocaleString()}</span></div>
                    <div className="text-gray-400">Oldest PGCR: <span className="text-gray-200">{stats.database.oldestPGCR ? new Date(stats.database.oldestPGCR).toLocaleString() : 'N/A'}</span></div>
                    <div className="text-gray-400">Newest PGCR: <span className="text-gray-200">{stats.database.newestPGCR ? new Date(stats.database.newestPGCR).toLocaleString() : 'N/A'}</span></div>
                </div>
            </section>

            <section className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <h2 className="text-lg font-semibold text-white mb-3">Scanner</h2>
                {stats.scanner ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="text-gray-400">Status: <span className="text-gray-200">{stats.scanner.isRunning ? 'Running' : 'Stopped'}</span></div>
                        <div className="text-gray-400">Position: <span className="text-gray-200">{stats.scanner.currentInstanceId}</span></div>
                        <div className="text-gray-400">Total Scanned: <span className="text-gray-200">{stats.scanner.totalScanned.toLocaleString()}</span></div>
                        <div className="text-gray-400">Raids Found: <span className="text-gray-200">{stats.scanner.totalRaidsFound.toLocaleString()}</span></div>
                        <div className="text-gray-400">Hit Rate: <span className="text-gray-200">{stats.scanner.raidHitRate}</span></div>
                        <div className="text-gray-400">Uptime: <span className="text-gray-200">{formatDuration(stats.scanner.uptimeSeconds)}</span></div>
                        <div className="text-gray-400">Last Update: <span className="text-gray-200">{formatSecondsAgo(stats.scanner.secondsSinceUpdate)}</span></div>
                    </div>
                ) : (
                    <p className="text-sm text-gray-400">Scanner stats not available yet.</p>
                )}
            </section>
        </div>
    );
}
