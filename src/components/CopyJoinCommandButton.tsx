'use client';

import { useEffect, useRef, useState } from 'react';

interface CopyJoinCommandButtonProps {
    /** The Join Command to copy, `/join Name#Code` (see `joinCommand` in roster.ts). */
    command: string;
    /** A displayed Roster of 6/6: the button stays, disabled, so the row keeps its width. */
    full: boolean;
}

/** How long the check mark and the copied command stay up after a successful copy. */
const COPIED_MS = 2000;

/**
 * After a click: copied (for {@link COPIED_MS}), or refused, with the command to copy by hand.
 * An object, so each click sets a new one and a second copy restarts the two seconds.
 */
interface CopyState {
    kind: 'idle' | 'copied' | 'failed';
}

const IDLE: CopyState = { kind: 'idle' };

// Inline SVG like SessionsViewToggle: the repo has no icon library.
function ClipboardIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-4 h-4">
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-4 h-4">
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}

/**
 * A list row's Join Command button: copies the fireteam's Join Command for a PC player to paste
 * into game chat. "Join code" is what a visitor sees; Join Command is the code's word (CONTEXT.md).
 *
 * Icon-only and the chevron's width at every screen size, so it never widens a row. The
 * feedback state lives here, in the row, so collapsing a raid section (which unmounts its rows)
 * drops it; that is accepted (#168).
 */
export default function CopyJoinCommandButton({ command, full }: CopyJoinCommandButtonProps) {
    const [state, setState] = useState<CopyState>(IDLE);
    const wrapperRef = useRef<HTMLSpanElement>(null);
    const shown = state.kind !== 'idle';

    useEffect(() => {
        if (state.kind !== 'copied') return;
        const timer = setTimeout(() => setState(IDLE), COPIED_MS);
        return () => clearTimeout(timer);
    }, [state]);

    // A refused copy stays up until the visitor is done with it: Escape, or a press anywhere
    // outside the button and its tooltip. A press inside the tooltip is how its text gets
    // selected, so it doesn't count.
    useEffect(() => {
        if (state.kind !== 'failed') return;
        function dismissOutside(event: PointerEvent) {
            if (!wrapperRef.current?.contains(event.target as Node)) setState(IDLE);
        }
        function dismissOnEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') setState(IDLE);
        }
        document.addEventListener('pointerdown', dismissOutside);
        document.addEventListener('keydown', dismissOnEscape);
        return () => {
            document.removeEventListener('pointerdown', dismissOutside);
            document.removeEventListener('keydown', dismissOnEscape);
        };
    }, [state]);

    async function copy() {
        try {
            // The async Clipboard API. It throws when the browser refuses (no permission, or
            // no `navigator.clipboard` at all outside a secure context); both land below.
            await navigator.clipboard.writeText(command);
            setState({ kind: 'copied' });
        } catch {
            setState({ kind: 'failed' });
        }
    }

    return (
        <span ref={wrapperRef} className="relative shrink-0 flex">
            <button
                type="button"
                onClick={copy}
                disabled={full}
                aria-label="Copy join code"
                title={full ? 'Fireteam full' : 'Copy join code'}
                className="-my-1 p-1 rounded ui-text-muted enabled:hover:text-[var(--ui-accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
                {state.kind === 'copied' ? <CheckIcon /> : <ClipboardIcon />}
            </button>
            {/* Always in the page, so a screen reader announces what lands in it; drawn as a
                tooltip only while it has something to say. It sits to the button's left, over
                the row's own line: the list clips anything above its first row or below its
                last, so it must stay two lines tall. Its width cap keeps it inside a 360px
                phone's card (32px gutters). The command breaks anywhere rather than at its
                space, and is in the body font rather than monospace, so the longest one still
                fits in two lines there. A click in it selects the command rather than toggling
                the row. */}
            <span
                role="status"
                onClick={(event) => event.stopPropagation()}
                className={shown ? 'ui-card ui-text-primary absolute right-full top-1/2 -translate-y-1/2 mr-2 z-10 w-max max-w-[calc(100vw-10rem)] rounded-md px-2 py-0.5 text-xs shadow-sm cursor-auto' : undefined}
            >
                {shown && (
                    <>
                        {state.kind === 'copied' ? 'Copied ' : 'Copy failed: '}
                        <code className="select-all break-all font-[inherit]">{command}</code>
                    </>
                )}
            </span>
        </span>
    );
}
