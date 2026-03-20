'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
    membershipId: string;
    membershipType: number;
    displayName: string;
    baseName: string;
    isExactFullMatch: boolean;
    isExactNameMatch: boolean;
}

export default function PlayerSearch() {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmed = query.trim();

    useEffect(() => {
        const onClickOutside = (event: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    useEffect(() => {
        if (trimmed.length < 2) {
            setResults([]);
            setOpen(false);
            setError(null);
            return;
        }

        const timeout = setTimeout(async () => {
            setLoading(true);
            setError(null);

            try {
                const res = await fetch(`/api/players/search?query=${encodeURIComponent(trimmed)}&limit=10`);
                if (!res.ok) throw new Error(`Search failed (${res.status})`);
                const data = await res.json();
                setResults(data.results || []);
                setOpen(true);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        }, 250);

        return () => clearTimeout(timeout);
    }, [trimmed]);

    const hasExact = useMemo(
        () => results.some((r) => r.isExactFullMatch || r.isExactNameMatch),
        [results]
    );

    const goToPlayer = (result: SearchResult) => {
        setOpen(false);
        router.push(`/player/${result.membershipType}/${result.membershipId}`);
    };

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();

        if (results.length === 1) {
            goToPlayer(results[0]);
            return;
        }

        const exactMatch = results.find((r) => r.isExactFullMatch);
        if (exactMatch) {
            goToPlayer(exactMatch);
            return;
        }

        setOpen(true);
    };

    return (
        <div ref={containerRef} className="relative w-full max-w-md">
            <form onSubmit={onSubmit} className="flex items-center gap-2">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                        if (results.length > 0) setOpen(true);
                    }}
                    type="text"
                    placeholder="Search player (e.g. Aegis or Aegis#4237)"
                    className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
                />
                <button
                    type="submit"
                    className="rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm px-3 py-2"
                >
                    Search
                </button>
            </form>

            {open && (
                <div className="absolute top-full mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 shadow-xl z-50 overflow-hidden">
                    {loading && (
                        <div className="px-3 py-2 text-sm text-gray-400">Searching...</div>
                    )}

                    {!loading && error && (
                        <div className="px-3 py-2 text-sm text-red-400">{error}</div>
                    )}

                    {!loading && !error && results.length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-400">
                            No matches found in local player database.
                        </div>
                    )}

                    {!loading && !error && results.length > 0 && (
                        <>
                            {!hasExact && (
                                <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-800">
                                    Multiple players can share the same base name. Select the exact profile.
                                </div>
                            )}
                            <div className="max-h-72 overflow-y-auto">
                                {results.map((result) => (
                                    <button
                                        key={`${result.membershipType}:${result.membershipId}`}
                                        onClick={() => goToPlayer(result)}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800 transition-colors"
                                    >
                                        <div className="text-gray-100">{result.displayName}</div>
                                        <div className="text-xs text-gray-500 font-mono">{result.membershipId}</div>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
