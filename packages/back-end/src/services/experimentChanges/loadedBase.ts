import { BadRequestError, ConflictError } from "back-end/src/util/errors";

export const changedSinceLoaded = (what: string) =>
  new ConflictError(
    `${what} changed since you loaded it. Reload to see the latest version, then make your changes again.`,
  );

export const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? null));

export const isoOrNull = (date: Date | undefined | null) =>
  date ? new Date(date).toISOString() : null;

export function assertBaseCoversChanges(
  changes: object,
  base: Record<string, unknown>,
) {
  const missing = Object.keys(changes).find((key) => !(key in base));
  if (missing) {
    throw new BadRequestError(`base is missing the loaded value of ${missing}`);
  }
}
