'use client';

import { useEffect, useState } from 'react';

interface MaintenanceStatus {
    bungieMaintenanceActive?: boolean;
    dbQuiesceActive?: boolean;
}

export default function BungieMaintenanceAlert() {
    const [isActive, setIsActive] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const fetchStatus = () => {
            fetch('/api/status')
                .then((res) => res.json())
                .then((status: MaintenanceStatus) => {
                    if (!cancelled) {
                        setIsActive(
                            status.bungieMaintenanceActive === true || status.dbQuiesceActive === true
                        );
                    }
                })
                .catch((error) => {
                    console.error('Failed to fetch Bungie maintenance status:', error);
                    if (!cancelled) {
                        setIsActive(false);
                    }
                });
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 15000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    if (!isActive) {
        return null;
    }

    return (
        <div className="max-w-7xl mx-auto px-4 pt-4" role="status" aria-live="polite">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                Bungie API is temporarily disabled for maintenance. No new data is being recorded.
            </p>
        </div>
    );
}
