'use client';

import { ROSTER_SIZE_CHIPS } from '@/lib/active-session/roster';

interface SessionSizeChipsProps {
    /** The Roster sizes shown. */
    sizes: readonly number[];
    onChange: (sizes: readonly number[]) => void;
}

/**
 * The fireteam-size filter: one toggle chip per Roster size, joined into one rounded control
 * like the View toggle. Each chip switches on and off by itself. The chips are 28px wide, not the
 * View toggle's 40: at that width the six and View fit one line of a 360px phone's control bar.
 */
export default function SessionSizeChips({ sizes, onChange }: SessionSizeChipsProps) {
    return (
        <div role="group" aria-label="Fireteam size" className="flex rounded-lg overflow-hidden border border-[var(--ui-border-input)] divide-x divide-[var(--ui-border-input)]">
            {ROSTER_SIZE_CHIPS.map((size) => {
                const label = `Fireteams of ${size}`;
                const on = sizes.includes(size);
                return (
                    <button
                        key={size}
                        type="button"
                        onClick={() => onChange(on ? sizes.filter((shown) => shown !== size) : [...sizes, size])}
                        aria-pressed={on}
                        aria-label={label}
                        title={label}
                        className={`inline-flex items-center justify-center w-7 h-9 text-sm tabular-nums transition-colors ${on
                            ? 'ui-toggle-active'
                            : 'ui-toggle-idle'
                            }`}
                    >
                        {size}
                    </button>
                );
            })}
        </div>
    );
}
