export type ConcurrentResult<R> =
    | { success: true; result: R }
    | { success: false; error: Error };

export interface ConcurrencyOptions<R> {
    collectResults?: boolean;
    onResult?: (result: ConcurrentResult<R>, index: number) => void;
}

/**
 * Process an array of items with a limited number of concurrent workers.
 * Each worker pulls from a shared queue and processes items one at a time.
 *
 * @param items - Array of items to process
 * @param concurrency - Max number of concurrent workers
 * @param processor - Async function to process each item
 * @param onProgress - Optional callback for progress reporting
 * @param options - Optional processing behavior (stream results, skip result collection)
 * @returns Array of results in the same order as input
 */
export async function processWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    processor: (item: T, index: number) => Promise<R>,
    onProgress?: (completed: number, total: number) => void,
    options?: ConcurrencyOptions<R>
): Promise<ConcurrentResult<R>[]> {
    const collectResults = options?.collectResults !== false;
    const results: ConcurrentResult<R>[] = collectResults ? new Array(items.length) : [];
    let nextIndex = 0;
    let completedCount = 0;

    async function worker() {
        while (true) {
            const index = nextIndex;
            nextIndex++;

            if (index >= items.length) break;

            let outcome: ConcurrentResult<R>;
            try {
                const result = await processor(items[index], index);
                outcome = { success: true, result };
            } catch (error) {
                outcome = { success: false, error: error as Error };
            }

            if (collectResults) {
                results[index] = outcome;
            }
            options?.onResult?.(outcome, index);

            completedCount++;
            if (onProgress) {
                onProgress(completedCount, items.length);
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => worker()
    );
    await Promise.all(workers);

    return results;
}
