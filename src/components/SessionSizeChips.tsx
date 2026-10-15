'use client';

import { ALL_SESSION_SIZES } from '@/hooks/useSessionSizes';

interface SessionSizeChipsProps {
    /** The Roster sizes shown. */
    sizes: readonly number[];
    onChange: (sizes: readonly number[]) => void;
}

/**
 * The fireteam-size filter: one toggle chip per Roster size, joined into one rounded control
 * like the View toggle. Each chip switches on and off by itself.
 */
export default function SessionSizeChips({ sizes, onChange }: SessionSizeChipsProps) {
    function toggle(size: number) {
        onChange(sizes.includes(size) ? sizes.filter((shown) => shown !== size) : [...sizes, size]);
    }

    return (
        <div role="group" aria-label="Fireteam size" className="flex rounded-lg overflow-hidden border border-[var(--ui-border-input)] divide-x divide-[var(--ui-border-input)]">
            {ALL_SESSION_SIZES.map((size) => {
                const label = `Fireteams of ${size}`;
                return (
                    <button
                        key={size}
                        type="button"
                        onClick={() => toggle(size)}
                        aria-pressed={sizes.includes(size)}
                        aria-label={label}
                        title={label}
                        className={`inline-flex items-center justify-center w-8 h-9 text-sm tabular-nums transition-colors ${sizes.includes(size)
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
