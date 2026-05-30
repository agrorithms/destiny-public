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

interface SearchApiResponse {
    results?: SearchResult[];
    fallbackUnavailable?: boolean;
    message?: string;
}

export default function PlayerSearch() {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const requestOrderRef = useRef(0);
    const latestAppliedRequestRef = useRef(0);
    const localRequestSeqRef = useRef(0);
    const fallbackRequestSeqRef = useRef(0);
    const resultsRef = useRef<SearchResult[]>([]);
    const trimmedRef = useRef('');

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [fallbackLoading, setFallbackLoading] = useState(false);
    const [fallbackUnavailable, setFallbackUnavailable] = useState(false);
    const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const trimmed = query.trim();

    useEffect(() => {
        resultsRef.current = results;
    }, [results]);

    useEffect(() => {
        trimmedRef.current = trimmed;
    }, [trimmed]);

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
            setFallbackUnavailable(false);
            setFallbackMessage(null);
            setFallbackLoading(false);
            setSelectedIndex(-1);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            const requestId = ++localRequestSeqRef.current;
            const requestOrder = ++requestOrderRef.current;
            setLoading(true);
            setError(null);
            setFallbackUnavailable(false);
            setFallbackMessage(null);

            try {
                const res = await fetch(
                    `/api/players/search?query=${encodeURIComponent(trimmed)}&limit=10&fallback=0`,
                    { signal: controller.signal }
                );
                if (!res.ok) throw new Error(`Search failed (${res.status})`);
                const data = await res.json() as SearchApiResponse;
                if (requestId !== localRequestSeqRef.current || trimmed !== trimmedRef.current) return;
                if (requestOrder < latestAppliedRequestRef.current) return;
                latestAppliedRequestRef.current = requestOrder;

                const nextResults = data.results || [];
                setResults(nextResults);
                setOpen(true);
                setSelectedIndex(nextResults.length > 0 ? 0 : -1);
            } catch (err) {
                if ((err as Error).name === 'AbortError') return;
                if (requestId !== localRequestSeqRef.current || trimmed !== trimmedRef.current) return;

                setError((err as Error).message);
                setSelectedIndex(-1);
            } finally {
                if (requestId === localRequestSeqRef.current) setLoading(false);
            }
        }, 250);

        return () => {
            controller.abort();
            clearTimeout(timeout);
        };
    }, [trimmed]);

    useEffect(() => {
        const baseName = getSearchBaseName(trimmed);

        if (baseName.length < 3) {
            setFallbackLoading(false);
            setFallbackUnavailable(false);
            setFallbackMessage(null);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            if (resultsRef.current.some((result) => result.isExactFullMatch)) {
                return;
            }

            const requestId = ++fallbackRequestSeqRef.current;
            const requestOrder = ++requestOrderRef.current;
            setFallbackLoading(true);
            setError(null);

            try {
                const res = await fetch(
                    `/api/players/search?query=${encodeURIComponent(trimmed)}&limit=10&fallback=1`,
                    { signal: controller.signal }
                );
                if (!res.ok) throw new Error(`Search failed (${res.status})`);
                const data = await res.json() as SearchApiResponse;
                if (requestId !== fallbackRequestSeqRef.current || trimmed !== trimmedRef.current) return;
                if (requestOrder < latestAppliedRequestRef.current) return;
                latestAppliedRequestRef.current = requestOrder;

                const nextResults = data.results || [];
                setResults(nextResults);
                setFallbackUnavailable(Boolean(data.fallbackUnavailable));
                setFallbackMessage(data.message || null);
                setOpen(true);
                setSelectedIndex(nextResults.length > 0 ? 0 : -1);
            } catch (err) {
                if ((err as Error).name === 'AbortError') return;
                if (requestId !== fallbackRequestSeqRef.current || trimmed !== trimmedRef.current) return;

                setError((err as Error).message);
                setSelectedIndex(-1);
            } finally {
                if (requestId === fallbackRequestSeqRef.current) setFallbackLoading(false);
            }
        }, 700);

        return () => {
            controller.abort();
            clearTimeout(timeout);
        };
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
                        if (results.length > 0 || fallbackUnavailable || error) setOpen(true);
                    }}
                    onKeyDown={onInputKeyDown}
                    type="text"
                    placeholder="Search player"
                    className="w-full rounded-lg ui-input ui-focus-accent px-3 py-2 text-sm placeholder:text-[var(--ui-text-muted)] focus:outline-none"
                />
                <button
                    type="submit"
                    className="rounded-lg ui-btn-primary text-sm px-3 py-2"
                >
                    Search
                </button>
            </form>

            {open && (
                <div className="absolute top-full mt-2 w-full rounded-lg ui-input shadow-xl z-50 overflow-hidden">
                    {loading && (
                        <div className="px-3 py-2 text-sm ui-text-secondary">Searching...</div>
                    )}

                    {!loading && error && (
                        <div className="px-3 py-2 text-sm text-red-400">{error}</div>
                    )}

                    {!loading && !error && results.length === 0 && (
                        <div className="px-3 py-2 text-sm ui-text-secondary">
                            No matches found in local player database.
                        </div>
                    )}

                    {!loading && !error && results.length > 0 && (
                        <>
                            {!hasExact && (
                                <div className="px-3 py-2 text-xs ui-text-muted border-b ui-divider">
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
                                        className={`w-full text-left px-3 py-2 text-sm ui-list-item-hover ${selectedIndex === index
                                            ? 'ui-list-item-active'
                                            : ''
                                            }`}
                                    >
                                        <div className="ui-text-primary">{result.displayName}</div>
                                        <div className="text-xs ui-text-muted">
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

                    {!loading && !error && fallbackLoading && (
                        <div className="px-3 py-2 text-xs ui-text-muted border-t ui-divider">
                            Searching Bungie...
                        </div>
                    )}

                    {!loading && !error && fallbackUnavailable && (
                        <div className="px-3 py-2 text-xs ui-text-muted border-t ui-divider">
                            {fallbackMessage || 'Bungie search unavailable'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function getSearchBaseName(query: string): string {
    const hashIndex = query.indexOf('#');
    return (hashIndex === -1 ? query : query.slice(0, hashIndex)).trim();
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
