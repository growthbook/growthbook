import { z } from "zod";
import { SnapshotType } from "shared/types/experiment-snapshot";
import { BadRequestError } from "back-end/src/util/errors";

// Express's extended query parser turns `?type[$ne]=x` into an object, so only
// plain strings are accepted. An absent or empty value means "not provided".
const optionalQueryString = z
  .union([z.string(), z.undefined()])
  .transform((value) => (value === "" ? undefined : value));

const snapshotTypeQuery = z
  .union([
    // `satisfies` fails type-check if SnapshotType gains or loses a member
    z.enum({
      standard: "standard",
      exploratory: "exploratory",
      report: "report",
    } satisfies Record<SnapshotType, SnapshotType>),
    z.literal(""),
    z.undefined(),
  ])
  .transform((value) => (value === "" ? undefined : value));

export function parseOptionalQueryString(
  name: string,
  value: unknown,
): string | undefined {
  const result = optionalQueryString.safeParse(value);
  if (!result.success) throw new BadRequestError(`Invalid ${name}`);
  return result.data;
}

export function parseSnapshotTypeQuery(
  value: unknown,
): SnapshotType | undefined {
  const result = snapshotTypeQuery.safeParse(value);
  if (!result.success) throw new BadRequestError("Invalid type");
  return result.data;
}
