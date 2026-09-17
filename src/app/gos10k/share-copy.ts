/**
 * How the Archive page renders a share, as a percentage.
 *
 * One implementation for every panel that prints one — the presence strip's share of the
 * clears' time (#89) and the class split (#94) — for the same reason duration-copy.ts
 * exists: two panels deciding separately how a ratio rounds is how `0.2%` on one reads
 * as `0%` on the other.
 *
 * One decimal, because the page's reference figures need it: the presence share is 91.55%,
 * which a whole number prints as 92% beside a spec that says "roughly 91%", and the class
 * split's unknown row is 0.2%, which a whole number prints as a class nobody brought. A
 * trailing `.0` is dropped — `100%`, not `100.0%` — because the round figures are exact.
 *
 * **Deliberately not clamped.** No share on this page can exceed 1, and in production none
 * does; if a data fault ever made one, `104%` is the fault being visible, where a clamp
 * would render it as a clean 100%. `—` for a non-finite share, which is what 0 of 0
 * produces: each panel guards on that case first, but a formatter that can print `NaN%`
 * is a guard nobody can see.
 */
export function formatShare(share: number): string {
    if (!Number.isFinite(share)) return '—';
    const percent = (share * 100).toFixed(1);
    return `${percent.endsWith('.0') ? percent.slice(0, -2) : percent}%`;
}
