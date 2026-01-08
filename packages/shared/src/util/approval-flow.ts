import isEqual from "lodash/isEqual";

/**
 * Conflict information for a field that has been modified in both
 * the live state and the proposed changes
 */
export type Conflict = {
  field: string; // The field name that has a conflict
  baseValue: unknown; // Value at the time approval flow was created
  liveValue: unknown; // Current value in the entity
  proposedValue: unknown; // Value being proposed in this approval flow
};

/**
 * Result of checking for merge conflicts
 */
export type MergeResult = {
  success: boolean;
  conflicts: Conflict[];
  canAutoMerge: boolean;
  fieldsChanged: string[];
  mergedChanges?: Record<string, unknown>;
};

/**
 * Check for merge conflicts on-the-fly
 * Compares: base (when approval flow was created) vs live (current state) vs proposed
 *
 * @param baseState - Entity state at baseVersion (when approval flow was created)
 * @param liveState - Current entity state
 * @param proposedChanges - Changes proposed in the approval flow
 * @returns MergeResult with conflict information and merged changes if possible
 */
export function checkMergeConflicts(
  baseState: Record<string, unknown>,
  liveState: Record<string, unknown>,
  proposedChanges: Record<string, unknown>
): MergeResult {
  const conflicts: Conflict[] = [];
  const fieldsChanged: string[] = [];
  const mergedChanges: Record<string, unknown> = { ...liveState };

  // Get all fields in proposed changes
  for (const field of Object.keys(proposedChanges)) {
    const baseValue = baseState[field];
    const liveValue = liveState[field];
    const proposedValue = proposedChanges[field];

    // Check if both live and proposed changed the same field from base
    const liveChanged = !isEqual(baseValue, liveValue);
    const proposedChanged = !isEqual(baseValue, proposedValue);

    if (liveChanged && proposedChanged) {
      // Conflict exists if they changed it to different values
      if (!isEqual(liveValue, proposedValue)) {
        conflicts.push({
          field,
          baseValue,
          liveValue,
          proposedValue,
        });
      } else {
        // Both changed to the same value - no conflict
        fieldsChanged.push(field);
      }
    } else if (proposedChanged) {
      // Only proposed changed - can auto-merge
      mergedChanges[field] = proposedValue;
      fieldsChanged.push(field);
    }
    // If only live changed, keep the live value (already in mergedChanges)
  }

  return {
    success: conflicts.length === 0,
    conflicts,
    canAutoMerge: conflicts.length === 0,
    fieldsChanged,
    mergedChanges: conflicts.length === 0 ? mergedChanges : undefined,
  };
}

