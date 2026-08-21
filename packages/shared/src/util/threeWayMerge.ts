export type ContestedChunk = { key: string; fields: string[] };

export type ThreeWayMergeResult<T> = {
  merged: T | null;
  contested: ContestedChunk[];
  theirFields: string[];
  yourFields: string[];
  wholeEntity: boolean;
};

export type ThreeWayMergeConfig<T> = {
  // Mutually-exclusive pairs; merged independently they can contradict.
  chunks?: string[][];
  ignoreFields?: (entity: T) => string[];
  // Differing families skip the field merge entirely.
  family?: (entity: T) => string;
  derive?: (merged: Record<string, unknown>) => void;
};

// One side's change wins automatically; chunks both sides changed differently
// are contested, with your value retained in `merged`.
export function threeWayMerge<T extends object>(
  base: T,
  theirs: T,
  yours: T,
  config: ThreeWayMergeConfig<T> = {},
): ThreeWayMergeResult<T> {
  const empty: ThreeWayMergeResult<T> = {
    merged: null,
    contested: [],
    theirFields: [],
    yourFields: [],
    wholeEntity: false,
  };
  if (config.family && config.family(theirs) !== config.family(yours)) {
    return { ...empty, wholeEntity: true };
  }

  const b = base as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  const y = yours as unknown as Record<string, unknown>;

  const chunkOf = new Map<string, string[]>();
  for (const chunk of config.chunks ?? []) {
    for (const f of chunk) chunkOf.set(f, chunk);
  }

  const ignored = new Set(config.ignoreFields?.(yours) ?? []);
  const allFields = [
    ...new Set([...Object.keys(b), ...Object.keys(t), ...Object.keys(y)]),
  ].filter((f) => !ignored.has(f));

  const units: ContestedChunk[] = [];
  const seen = new Set<string>();
  for (const f of allFields) {
    if (seen.has(f)) continue;
    const fields = (chunkOf.get(f) ?? [f]).filter((cf) =>
      allFields.includes(cf),
    );
    fields.forEach((cf) => seen.add(cf));
    units.push({ key: fields[0], fields });
  }

  // An empty array and an absent key mean the same thing to the editor.
  const canon = (v: unknown) =>
    Array.isArray(v) && v.length === 0 ? null : (v ?? null);
  const pick = (obj: Record<string, unknown>, fields: string[]) =>
    JSON.stringify(fields.map((f) => canon(obj[f])));

  const result = { ...empty, merged: { ...yours } };
  for (const unit of units) {
    const bv = pick(b, unit.fields);
    const tv = pick(t, unit.fields);
    const yv = pick(y, unit.fields);
    const theirsChanged = tv !== bv;
    const yoursChanged = yv !== bv;

    // An omitted field can't be expressed on the wire, so a choice is a no-op.
    const yoursOmitted = unit.fields.every((f) => y[f] === undefined);

    if (theirsChanged && yoursChanged && tv !== yv && !yoursOmitted) {
      result.contested.push(unit);
    } else if (theirsChanged && (!yoursChanged || yoursOmitted)) {
      const merged = result.merged as unknown as Record<string, unknown>;
      for (const f of unit.fields) {
        if (f in t) merged[f] = t[f];
        else delete merged[f];
      }
      result.theirFields.push(...unit.fields.filter((f) => f in t || f in y));
    } else if (yoursChanged) {
      result.yourFields.push(...unit.fields.filter((f) => f in y || f in t));
    }
  }

  config.derive?.(result.merged as unknown as Record<string, unknown>);
  return result;
}
