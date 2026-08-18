/** Review and Publish leaves start/schedule checkboxes unchecked until the user opts in. */
export function getDefaultSelectedExperimentIds(): Set<string> {
  return new Set();
}

export function reconcileSelectedExperimentIds({
  prevSelected,
  currentIds,
}: {
  prevSelected: Set<string>;
  currentIds: Set<string>;
}): Set<string> {
  const next = new Set([...prevSelected].filter((id) => currentIds.has(id)));
  const unchanged =
    next.size === prevSelected.size &&
    [...next].every((id) => prevSelected.has(id));
  return unchanged ? prevSelected : next;
}
