import { z } from "zod";

/**
 * A record's assignment query and the identifier type it analyzes on, grouped
 * in the API; stored flat. Each field comes with a deprecated flat ID.
 */
export type AssignmentQueryField = "assignmentQuery" | "exposureQuery";

export const apiAssignmentQueryRef = z.object({
  id: z
    .string()
    .describe("The ID of one of the data source's assignment queries."),
  identifierType: z
    .string()
    .nullable()
    .describe(
      "The identifier type analyzed on. Null when none can be resolved: no assignment query is selected, or a record saved before identifier types were stored points at a query that no longer exists.",
    ),
});
export type ApiAssignmentQueryRef = z.infer<typeof apiAssignmentQueryRef>;

export const apiAssignmentQueryRefInput = z.object({
  id: z
    .string()
    .describe("The ID of one of the data source's assignment queries."),
  identifierType: z
    .string()
    .nullable()
    .describe(
      "The identifier type to analyze on, which the query must declare. Required when selecting a different assignment query that declares several. Otherwise defaults to the current identifier type, or the query's only one. Null is treated as omitted, so a response's value can be sent back.",
    )
    .optional(),
});
export type ApiAssignmentQueryRefInput = z.infer<
  typeof apiAssignmentQueryRefInput
>;

const groupedDescription =
  "The assignment query, grouping its ID with the identifier type analyzed on.";
const deprecatedDescription = (field: AssignmentQueryField) =>
  `Deprecated: use \`${field}\`.`;

type ResponseFields<F extends AssignmentQueryField> = {
  [K in F]: typeof apiAssignmentQueryRef;
} & { [K in `${F}Id`]: z.ZodString };

export function apiAssignmentQueryResponseFields<
  F extends AssignmentQueryField,
>(field: F): ResponseFields<F> {
  return {
    [field]: apiAssignmentQueryRef.describe(groupedDescription),
    [`${field}Id`]: z
      .string()
      .describe(deprecatedDescription(field))
      .meta({ deprecated: true }),
  } as ResponseFields<F>;
}

type OptionalResponseFields<F extends AssignmentQueryField> = {
  [K in F]: z.ZodOptional<typeof apiAssignmentQueryRef>;
} & { [K in `${F}Id`]: z.ZodOptional<z.ZodString> };

/** For responses where a record may have no assignment query at all. */
export function apiOptionalAssignmentQueryResponseFields<
  F extends AssignmentQueryField,
>(field: F): OptionalResponseFields<F> {
  return {
    [field]: apiAssignmentQueryRef.describe(groupedDescription).optional(),
    [`${field}Id`]: z
      .string()
      .describe(deprecatedDescription(field))
      .optional()
      .meta({ deprecated: true }),
  } as OptionalResponseFields<F>;
}

type InputFields<F extends AssignmentQueryField> = {
  [K in F]: z.ZodOptional<typeof apiAssignmentQueryRefInput>;
} & { [K in `${F}Id`]: z.ZodOptional<z.ZodString> };

/**
 * Request schemas: both optional, and must agree when both are sent
 * (parseAssignmentQueryInput). `note` adds endpoint-specific constraints to
 * both descriptions.
 */
export function apiAssignmentQueryInputFields<F extends AssignmentQueryField>(
  field: F,
  note?: string,
): InputFields<F> {
  const suffix = note ? ` ${note}` : "";
  return {
    [field]: apiAssignmentQueryRefInput
      .describe(
        `${groupedDescription} Mutually exclusive with the deprecated \`${field}Id\`.${suffix}`,
      )
      .optional(),
    [`${field}Id`]: z
      .string()
      .describe(
        `${deprecatedDescription(field)} Rejected when selecting a different assignment query that declares several identifier types; set \`${field}.identifierType\` instead.${suffix}`,
      )
      .optional()
      .meta({ deprecated: true }),
  } as InputFields<F>;
}
