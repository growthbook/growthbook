type UpdateDocument = Record<string, unknown>;
export type StampableUpdate = UpdateDocument | UpdateDocument[];

function isPlainObject(value: unknown): value is UpdateDocument {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Returns a copy of a Mongo update that also sets changeStamp. Pipelines get an
// extra $set stage; anything else gets it merged into $set, which also works
// for implicit-set objects like `{ name }`. The caller's update is not changed.
export function withChangeStamp(
  update: StampableUpdate | null | undefined,
  changeStamp: string,
): StampableUpdate {
  if (Array.isArray(update)) {
    return [...update, { $set: { changeStamp } }];
  }
  const rest: UpdateDocument = { ...(update ?? {}) };
  delete rest.changeStamp;
  const $set = isPlainObject(rest.$set) ? rest.$set : {};
  return { ...rest, $set: { ...$set, changeStamp } };
}
