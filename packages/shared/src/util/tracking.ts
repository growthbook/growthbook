// What product events hash to identify an entity, or one revision of it, so a
// metric can count them distinctly without exposing customer-chosen keys. The
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
