// Bulk import stores metric ids with a single fact__ prefix, adding it only when absent.
export const metricKey = (id: string): string =>
  id.startsWith("fact__") ? id : `fact__${id}`;

export interface ManagedItem {
  id: string;
  managedBy: string;
  archived: boolean;
}

// Archive dbt-managed items that left dbt and unarchive ones that came back.
// Archiving, not deleting, keeps old experiment results resolvable.
export function archiveChanges(
  items: ManagedItem[],
  keep: Set<string>,
): { id: string; archived: boolean }[] {
  return items
    .filter((i) => i.managedBy === "dbt")
    .flatMap((i) => {
      const stale = !keep.has(i.id);
      return stale === i.archived ? [] : [{ id: i.id, archived: stale }];
    });
}
