// What product events hash to identify an entity, or one revision of it. The
// org keeps two orgs' entities with the same key apart.
export function entityTrackingKey(
  orgId: string,
  entityId: string,
  version: number | null = null,
): string {
  return version === null
    ? `${orgId}:${entityId}`
    : `${orgId}:${entityId}:${version}`;
}
