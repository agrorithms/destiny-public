'use client';

import { useEffect, useState } from 'react';

type StatusResponse = {
  secondsSinceHeartbeat?: number | null;
  timestamp?: number;
};

function formatFreshness(secondsSinceHeartbeat?: number | null): string {
  if (secondsSinceHeartbeat == null || Number.isNaN(secondsSinceHeartbeat)) {
    return 'Status unavailable';
  }

  if (secondsSinceHeartbeat < 60) {
    return `Updated ${Math.max(0, Math.floor(secondsSinceHeartbeat))}s ago`;
  }

  const minutes = Math.floor(secondsSinceHeartbeat / 60);
  if (minutes < 60) {
    return `Updated ${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

export default function FooterStatus() {
  const [label, setLabel] = useState('Checking status...');

  useEffect(() => {
    let isMounted = true;

    const loadStatus = async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) {
          if (isMounted) {
            setLabel('Status unavailable');
          }
          return;
        }

        const data = (await response.json()) as StatusResponse;

        if (!isMounted) {
          return;
        }

        const freshness = formatFreshness(data.secondsSinceHeartbeat);
        if (freshness !== 'Status unavailable') {
          setLabel(freshness);
          return;
        }

        if (typeof data.timestamp === 'number') {
          const secondsAgo = Math.max(0, Math.floor((Date.now() - data.timestamp) / 1000));
          setLabel(formatFreshness(secondsAgo));
          return;
        }

        setLabel('Status unavailable');
      } catch {
        if (isMounted) {
          setLabel('Status unavailable');
        }
      }
    };

    loadStatus();
    const intervalId = setInterval(loadStatus, 60_000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return <span className="footer-status">{label}</span>;
}
