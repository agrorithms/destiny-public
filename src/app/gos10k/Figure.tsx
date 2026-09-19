/**
 * An emphasised number, inside a sentence.
 *
 * One implementation for the panels whose copy states figures mid-sentence — the presence
 * strip (#89) and the Resets panel (#93). The Resets panel wrote it as a component while
 * the presence strip inlined the same three classes three times; one of those drifting is
 * how two numbers in one paragraph stop looking alike.
 *
 * `tabular-nums` is the load-bearing part: these sit beside each other in running text,
 * and proportional digits make a run of them ragged.
 */
export function Figure({ children }: { children: React.ReactNode }) {
    return <span className="font-medium ui-text-primary tabular-nums">{children}</span>;
}
