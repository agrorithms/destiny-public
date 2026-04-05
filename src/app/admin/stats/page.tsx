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
            <h1 className="text-3xl font-bold ui-text-primary">Admin Stats</h1>

            <div className="ui-card px-4 py-3 text-sm ui-text-secondary">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span>Scanner</span>
                        <div
                            className={`w-2 h-2 rounded-full ${stats.scanner?.isRunning ? 'bg-blue-500 animate-pulse' : 'bg-red-500'
                                }`}
                        />
                        <span>{stats.scanner?.isRunning ? 'Running' : 'Stopped'}</span>
                    </div>
                    <span className="ui-text-subtle">|</span>
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
                        <span className="ui-text-muted">({formatSecondsAgo(stats.secondsSinceHeartbeat)})</span>
                    </div>
                </div>
            </div>

            <section className="ui-card p-4">
                <h2 className="text-lg font-semibold ui-text-primary mb-3">Database</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="ui-text-secondary">Players: <span className="ui-text-primary">{stats.database.totalPlayers.toLocaleString()}</span></div>
                    <div className="ui-text-secondary">PGCRs: <span className="ui-text-primary">{stats.database.totalPGCRs.toLocaleString()}</span></div>
                    <div className="ui-text-secondary">PGCR Entries: <span className="ui-text-primary">{stats.database.totalPGCRPlayers.toLocaleString()}</span></div>
                    <div className="ui-text-secondary">Active Sessions: <span className="ui-text-primary">{stats.database.activeSessions.toLocaleString()}</span></div>
                    <div className="ui-text-secondary">Oldest PGCR: <span className="ui-text-primary">{stats.database.oldestPGCR ? new Date(stats.database.oldestPGCR).toLocaleString() : 'N/A'}</span></div>
                    <div className="ui-text-secondary">Newest PGCR: <span className="ui-text-primary">{stats.database.newestPGCR ? new Date(stats.database.newestPGCR).toLocaleString() : 'N/A'}</span></div>
                </div>
            </section>

            <section className="ui-card p-4">
                <h2 className="text-lg font-semibold ui-text-primary mb-3">Scanner</h2>
                {stats.scanner ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="ui-text-secondary">Status: <span className="ui-text-primary">{stats.scanner.isRunning ? 'Running' : 'Stopped'}</span></div>
                        <div className="ui-text-secondary">Position: <span className="ui-text-primary">{stats.scanner.currentInstanceId}</span></div>
                        <div className="ui-text-secondary">Total Scanned: <span className="ui-text-primary">{stats.scanner.totalScanned.toLocaleString()}</span></div>
                        <div className="ui-text-secondary">Raids Found: <span className="ui-text-primary">{stats.scanner.totalRaidsFound.toLocaleString()}</span></div>
                        <div className="ui-text-secondary">Hit Rate: <span className="ui-text-primary">{stats.scanner.raidHitRate}</span></div>
                        <div className="ui-text-secondary">Uptime: <span className="ui-text-primary">{formatDuration(stats.scanner.uptimeSeconds)}</span></div>
                        <div className="ui-text-secondary">Last Update: <span className="ui-text-primary">{formatSecondsAgo(stats.scanner.secondsSinceUpdate)}</span></div>
                    </div>
                ) : (
                    <p className="text-sm ui-text-secondary">Scanner stats not available yet.</p>
                )}
            </section>
        </div>
    );
}
