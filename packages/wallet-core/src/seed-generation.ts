/**
 * Ties the running wallet backend to the seed it was built from.
 *
 * The backend is a singleton created from the phrase in secure storage. If a
 * different phrase is saved afterwards (an import abandoned, then "Create
 * wallet"), the singleton must not be handed out again: it would keep
 * serving the previous wallet while the stored phrase, and the backup
 * screen, already say the new one. Counting seed changes makes that check
 * cheap and free of storage reads.
 */
export function createSeedGenerationTracker() {
  let current = 0;
  let bound = -1;
  return {
    /** A phrase was written: anything built before is stale. */
    bump(): void { current += 1; },
    /** The backend being built now belongs to the current phrase. */
    bind(): void { bound = current; },
    /** True when the bound backend predates the latest phrase. */
    stale(): boolean { return bound !== current; },
    /** Nothing bound any more. */
    unbind(): void { bound = -1; },
  };
}

export const seedGeneration = createSeedGenerationTracker();
