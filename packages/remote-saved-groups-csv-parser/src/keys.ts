/**
 * The string an ID is stored and looked up as. Numbers use their shortest
 * form, so `001`, `1.0` and `1e0` all match an attribute value of `1`.
 * Resolvers must convert attribute values the same way: `String(value)`.
 */
export function toRemoteGroupKey(id: string, numeric: boolean): string {
  return numeric ? String(Number(id)) : id;
}
