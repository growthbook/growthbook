import { ReactNode } from "react";
import { ConstantInterface } from "shared/types/constant";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

// Render a simple before → after block for each field that actually changed.
function renderFieldDiffs(
  pre: Partial<ConstantInterface> | null,
  post: Partial<ConstantInterface>,
  fields: { key: keyof ConstantInterface; label: string }[],
): ReactNode | null {
  const rows = fields.filter(({ key }) => {
    const before = stringifyValue(pre?.[key]);
    const after = stringifyValue(post[key]);
    return before !== after;
  });
  if (rows.length === 0) return null;

  return (
    <Flex direction="column" gap="3">
      {rows.map(({ key, label }) => (
        <Box key={String(key)}>
          <Text weight="medium" size="small">
            {label}
          </Text>
          <Flex gap="3" align="start" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="small" color="text-mid">
                Before
              </Text>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {stringifyValue(pre?.[key])}
              </pre>
            </Box>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="small" color="text-mid">
                After
              </Text>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {stringifyValue(post[key])}
              </pre>
            </Box>
          </Flex>
        </Box>
      ))}
    </Flex>
  );
}

export const REVISION_CONSTANT_DIFF_CONFIG: RevisionDiffConfig<ConstantInterface> =
  {
    sections: [
      {
        label: "Settings",
        keys: [
          "name",
          "owner",
          "description",
          "projects",
          "archived",
        ] as (keyof ConstantInterface)[],
        render: (pre, post) =>
          renderFieldDiffs(pre, post, [
            { key: "name", label: "Name" },
            { key: "owner", label: "Owner" },
            { key: "description", label: "Description" },
            { key: "projects", label: "Projects" },
            { key: "archived", label: "Archived" },
          ]),
      },
      {
        label: "Value",
        keys: ["value", "environmentValues"] as (keyof ConstantInterface)[],
        render: (pre, post) =>
          renderFieldDiffs(pre, post, [
            { key: "value", label: "Value" },
            { key: "environmentValues", label: "Environment overrides" },
          ]),
      },
    ],
  };
