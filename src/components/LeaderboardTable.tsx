'use client';

interface LeaderboardEntry {
    membershipId: string;
    membershipType: number;
    displayName: string;
    completions: number;
}

interface LeaderboardTableProps {
    entries: LeaderboardEntry[];
    loading?: boolean;
    title?: string;
    showRaidColumn?: boolean;
    raidName?: string;
}

export default function LeaderboardTable({
    entries,
    loading = false,
    title,
    showRaidColumn = false,
    raidName,
}: LeaderboardTableProps) {
    if (loading) {
        return (
            <div className="space-y-2">
                {title && <h3 className="text-lg font-bold ui-text-primary mb-3">{title}</h3>}
                {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="h-10 ui-skeleton rounded animate-pulse" />
                ))}
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="text-center py-12 ui-text-muted">
                {title && <h3 className="text-lg font-bold ui-text-primary mb-3">{title}</h3>}
                <p className="text-lg">No completions found</p>
                <p className="text-sm mt-1">Try adjusting the time range or raid filter</p>
            </div>
        );
    }

    return (
        <div>
            {title && <h3 className="text-lg font-bold ui-text-primary mb-3">{title}</h3>}
            <div className="overflow-hidden">
                <table className="w-full table-fixed text-sm">
                    <colgroup>
                        <col className="w-[2.25rem] sm:w-10" />
                        <col />
                        {showRaidColumn && <col className="w-[5.5rem] sm:w-28" />}
                        <col className="w-[4.25rem] sm:w-20" />
                    </colgroup>
                    <thead>
                        <tr className="border-b ui-divider ui-text-muted">
                            <th className="text-left py-1 px-1.5 sm:px-2">#</th>
                            <th className="text-left py-1 px-1.5 sm:px-2">Player</th>
                            {showRaidColumn && <th className="text-left py-1 px-1.5 sm:px-2">Raid</th>}
                            <th className="text-right py-1 px-1.5 sm:px-2">Clears</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry, index) => (
                            <tr
                                key={entry.membershipId}
                                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                            >
                                <td className="py-1.25 px-1.5 sm:px-2 ui-text-muted">
                                    {index < 3 ? (
                                        <span className={`font-bold ${index === 0 ? 'text-yellow-400' :
                                            index === 1 ? 'text-gray-500 dark:text-gray-300' :
                                                'text-amber-600'
                                            }`}>
                                            {index + 1}
                                        </span>
                                    ) : (
                                        index + 1
                                    )}
                                </td>
                                <td className="min-w-0 overflow-hidden py-1.25 px-1.5 sm:px-2">
                                    <a
                                        href={`/player/${entry.membershipType}/${entry.membershipId}`}
                                        className="block min-w-0 truncate ui-text-primary hover:text-blue-600 transition-colors dark:hover:text-blue-400"
                                        title={entry.displayName}
                                    >
                                        {entry.displayName}
                                    </a>
                                </td>
                                {showRaidColumn && (
                                    <td className="truncate py-1.25 px-1.5 sm:px-2 ui-text-muted" title={raidName}>
                                        {raidName}
                                    </td>
                                )}
                                <td className="py-1.25 px-1.5 sm:px-2 text-right font-mono font-bold whitespace-nowrap ui-text-primary">
                                    {entry.completions}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
