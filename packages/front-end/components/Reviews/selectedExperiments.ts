/**
 * Immediate-start experiments stay unchecked so publishing a feature does
 * not start them unless the user opts in. Scheduled experiments stay
 * selected so their already-planned start is still approved by default.
 */
export function getDefaultSelectedExperimentIds(
  scheduledExperimentIds: Iterable<string>,
): Set<string> {
  return new Set(scheduledExperimentIds);
}

export function reconcileSelectedExperimentIds({
  prevSelected,
  currentIds,
  knownIds,
  scheduledIds,
}: {
  prevSelected: Set<string>;
  currentIds: Set<string>;
  knownIds: Set<string>;
  scheduledIds: Set<string>;
}): Set<string> {
  const newlyAdded = [...currentIds].filter((id) => !knownIds.has(id));
  const next = new Set([...prevSelected].filter((id) => currentIds.has(id)));
  for (const id of newlyAdded) {
    if (scheduledIds.has(id)) next.add(id);
  }
  const unchanged =
    next.size === prevSelected.size &&
    [...next].every((id) => prevSelected.has(id));
  return unchanged ? prevSelected : next;
}
