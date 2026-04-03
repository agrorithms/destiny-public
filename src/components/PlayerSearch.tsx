'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
    membershipId: string;
    membershipType: number;
    displayName: string;
    baseName: string;
    secondaryDisplayName: string;
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
    const [selectedIndex, setSelectedIndex] = useState(-1);

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
            setSelectedIndex(-1);
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
                setSelectedIndex((data.results || []).length > 0 ? 0 : -1);
            } catch (err) {
                setError((err as Error).message);
                setSelectedIndex(-1);
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

        if (selectedIndex >= 0 && selectedIndex < results.length) {
            goToPlayer(results[selectedIndex]);
            return;
        }

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

    const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (!open || results.length === 0) {
            if (event.key === 'ArrowDown' && results.length > 0) {
                setOpen(true);
                setSelectedIndex(0);
            }
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % results.length);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            return;
        }
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
                    onKeyDown={onInputKeyDown}
                    type="text"
                    placeholder="Search player"
                    className="w-full rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:placeholder:text-gray-500"
                />
                <button
                    type="submit"
                    className="rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm px-3 py-2"
                >
                    Search
                </button>
            </form>

            {open && (
                <div className="absolute top-full mt-2 w-full rounded-lg border border-gray-200 bg-white shadow-xl z-50 overflow-hidden dark:border-gray-700 dark:bg-gray-900">
                    {loading && (
                        <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">Searching...</div>
                    )}

                    {!loading && error && (
                        <div className="px-3 py-2 text-sm text-red-400">{error}</div>
                    )}

                    {!loading && !error && results.length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                            No matches found in local player database.
                        </div>
                    )}

                    {!loading && !error && results.length > 0 && (
                        <>
                            {!hasExact && (
                                <div className="px-3 py-2 text-xs text-gray-600 border-b border-gray-200 dark:text-gray-500 dark:border-gray-800">
                                    Multiple players can share the same base name. Select the exact profile.
                                </div>
                            )}
                            <div className="max-h-72 overflow-y-auto">
                                {results.map((result, index) => (
                                    <button
                                        key={`${result.membershipType}:${result.membershipId}`}
                                        type="button"
                                        onClick={() => goToPlayer(result)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${selectedIndex === index
                                            ? 'bg-gray-100 dark:bg-gray-800'
                                            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                                            }`}
                                    >
                                        <div className="text-gray-900 dark:text-gray-100">{result.displayName}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-500">
                                            {getMembershipTypeLabel(result.membershipType)}
                                            {(result.secondaryDisplayName || result.baseName)
                                                && (result.secondaryDisplayName || result.baseName).toLowerCase() !== result.displayName.toLowerCase()
                                                ? ` • ${result.secondaryDisplayName || result.baseName}`
                                                : ''}
                                        </div>
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

function getMembershipTypeLabel(membershipType: number): string {
    switch (membershipType) {
        case 1: return 'Xbox';
        case 2: return 'PlayStation';
        case 3: return 'Steam';
        case 5: return 'Stadia';
        case 6: return 'Epic';
        default: return 'Unknown Platform';
    }
}
