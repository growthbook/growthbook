import { ConflictError } from "back-end/src/util/errors";

export const changedSinceLoaded = (what: string) =>
  new ConflictError(
    `${what} changed since you loaded it. Reload to see the latest version, then make your changes again.`,
  );

export const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? null));

export const isoOrNull = (date: Date | undefined | null) =>
  date ? new Date(date).toISOString() : null;
