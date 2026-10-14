'use client';

import type { JSX } from 'react';
import type { SessionsView } from '@/hooks/useSessionsView';

interface SessionsViewToggleProps {
    view: SessionsView;
    onChange: (view: SessionsView) => void;
}

// Inline SVG like ThemeToggle: the repo has no icon library.
function ListIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    );
}

function TileIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
        </svg>
    );
}

const OPTIONS: { view: SessionsView; label: string; Icon: () => JSX.Element }[] = [
    { view: 'list', label: 'List view', Icon: ListIcon },
    { view: 'tiles', label: 'Tile view', Icon: TileIcon },
];

/** One rounded control split into two icon buttons, styled like the leaderboard's View toggle. */
export default function SessionsViewToggle({ view, onChange }: SessionsViewToggleProps) {
    return (
        <div role="group" aria-label="View" className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            {OPTIONS.map(({ view: option, label, Icon }) => (
                <button
                    key={option}
                    type="button"
                    onClick={() => onChange(option)}
                    aria-pressed={view === option}
                    aria-label={label}
                    title={label}
                    className={`inline-flex items-center justify-center w-10 h-9 transition-colors ${view === option
                        ? 'ui-toggle-active'
                        : 'ui-toggle-idle'
                        }`}
                >
                    <Icon />
                </button>
            ))}
        </div>
    );
}
