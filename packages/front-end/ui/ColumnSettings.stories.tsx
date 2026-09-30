import React, { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import ColumnSettings, { ManagedColumn } from "./ColumnSettings";

const INITIAL: ManagedColumn[] = [
  { id: "name", label: "Attribute", visible: true, alwaysVisible: true },
  { id: "description", label: "Description", visible: true },
  { id: "datatype", label: "Data Type", visible: true },
  { id: "projects", label: "Projects", visible: true },
  { id: "tags", label: "Tags", visible: false },
  { id: "references", label: "References", visible: true },
];

export default function ColumnSettingsStories() {
  const [columns, setColumns] = useState<ManagedColumn[]>(INITIAL);
  const [plain, setPlain] = useState<ManagedColumn[]>(
    INITIAL.filter((c) => !c.alwaysVisible),
  );

  const apply =
    (setter: React.Dispatch<React.SetStateAction<ManagedColumn[]>>) =>
    (next: { id: string; visible: boolean }[]) =>
      setter((prev) =>
        next.map(({ id, visible }) => ({
          ...(prev.find((c) => c.id === id) as ManagedColumn),
          visible,
        })),
      );

  const isCustomized =
    JSON.stringify(columns) !== JSON.stringify(INITIAL) || false;

  return (
    <Flex direction="column" gap="6">
      <Box>
        <Box className="mb-2">
          <Text weight="medium">
            With an always-visible column, and reset available
          </Text>
        </Box>
        <Box style={{ width: 260 }}>
          <ColumnSettings
            columns={columns}
            onChange={apply(setColumns)}
            onReset={() => setColumns(INITIAL)}
            canReset={isCustomized}
          />
        </Box>
        <Box className="mt-2">
          <Text size="1" color="gray">
            The Attribute row is checked and disabled — it can be reordered but
            not hidden. Everything else toggles.
          </Text>
        </Box>
      </Box>

      <Box>
        <Box className="mb-2">
          <Text weight="medium">All columns toggleable, no reset link</Text>
        </Box>
        <Box style={{ width: 260 }}>
          <ColumnSettings columns={plain} onChange={apply(setPlain)} />
        </Box>
      </Box>

      <Box>
        <Box className="mb-2">
          <Text weight="medium">Single column</Text>
        </Box>
        <Box style={{ width: 260 }}>
          <ColumnSettings
            columns={[{ id: "only", label: "Only column", visible: true }]}
            onChange={() => {
              /* noop */
            }}
          />
        </Box>
      </Box>
    </Flex>
  );
}
