import { GroupMap, SavedGroupForPayload } from "shared/types/saved-group";

/**
 * A remote group checked against another attribute is a "derived" group, with
 * the ID `<group id>:<attribute>`. It exists only in payloads: its entry looks
 * the attribute's value up in the source group's IDs (`valuesFrom`).
 */
export function getDerivedGroupId(groupId: string, attribute: string): string {
  return `${groupId}:${attribute}`;
}

/**
 * The source group and attribute of a derived ID, when the source is a remote
 * group in `groupMap`. Group IDs never contain ":", so the first one splits it.
 */
export function parseDerivedGroupId(
  id: string,
  groupMap: Map<string, Pick<SavedGroupForPayload, "type">>,
): { sourceId: string; attribute: string } | null {
  const i = id.indexOf(":");
  if (i < 1 || i === id.length - 1) return null;
  const sourceId = id.slice(0, i);
  if (groupMap.get(sourceId)?.type !== "remote") return null;
  return { sourceId, attribute: id.slice(i + 1) };
}

/** Whether `id` is a remote group, or a group derived from one. */
export function isRemoteGroupId(id: unknown, groupMap: GroupMap): boolean {
  return (
    typeof id === "string" &&
    (groupMap.get(id)?.type === "remote" || !!parseDerivedGroupId(id, groupMap))
  );
}

/**
 * The derived groups among `ids`, built from their source groups, so payload
 * code can treat them like any saved group.
 */
export function getDerivedRemoteGroups<
  T extends SavedGroupForPayload & { id: string },
>(ids: Iterable<string>, savedGroups: T[]): T[] {
  const byId = new Map(savedGroups.map((g) => [g.id, g]));
  return [...ids].flatMap((id) => {
    const derived = parseDerivedGroupId(id, byId);
    const source = derived && byId.get(derived.sourceId);
    return source && derived
      ? [{ ...source, id, attributeKey: derived.attribute }]
      : [];
  });
}
