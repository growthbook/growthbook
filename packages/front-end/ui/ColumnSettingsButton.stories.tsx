import React, { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PiSlidersHorizontal } from "react-icons/pi";
import Link from "@/ui/Link";
import ColumnSettingsButton from "./ColumnSettingsButton";
import { ManagedColumn } from "./ColumnSettings";

const INITIAL: ManagedColumn[] = [
  { id: "name", label: "Attribute", visible: true, alwaysVisible: true },
  { id: "description", label: "Description", visible: true },
  { id: "datatype", label: "Data Type", visible: true },
  { id: "tags", label: "Tags", visible: false },
  { id: "references", label: "References", visible: false },
];

export default function ColumnSettingsButtonStories() {
  const [columns, setColumns] = useState<ManagedColumn[]>(INITIAL);

  const onChange = (next: { id: string; visible: boolean }[]) =>
    setColumns((prev) =>
      next.map(({ id, visible }) => ({
        ...(prev.find((c) => c.id === id) as ManagedColumn),
        visible,
      })),
    );

  const hiddenCount = columns.filter((c) => !c.visible).length;

  return (
    <Flex direction="column" gap="6">
      <Box>
        <Box className="mb-2">
          <Text weight="medium">
            Default toolbar trigger, with a hidden-column count
          </Text>
        </Box>
        <ColumnSettingsButton
          columns={columns}
          hiddenCount={hiddenCount}
          onChange={onChange}
          onReset={() => setColumns(INITIAL)}
          canReset={hiddenCount !== 2}
          note="The Attribute column is always shown."
        />
        <Box className="mt-2">
          <Text size="1" color="gray">
            Trigger weight matches `FilterHeading`, so it sits alongside search
            filters in a toolbar row.
          </Text>
        </Box>
      </Box>

      <Box>
        <Box className="mb-2">
          <Text weight="medium">Custom trigger</Text>
        </Box>
        <ColumnSettingsButton
          columns={columns}
          onChange={onChange}
          note="The Experiment column is always shown."
          trigger={
            <Link size="sm" style={{ whiteSpace: "nowrap" }}>
              <Flex align="center" gap="1">
                <PiSlidersHorizontal />
                Edit
              </Flex>
            </Link>
          }
        />
        <Box className="mt-2">
          <Text size="1" color="gray">
            What the dashboard sidebar uses — it surfaces the hidden count in
            its own summary line, so the trigger omits it.
          </Text>
        </Box>
      </Box>

      <Box>
        <Box className="mb-2">
          <Text weight="medium">Nothing hidden</Text>
        </Box>
        <ColumnSettingsButton
          columns={INITIAL.map((c) => ({ ...c, visible: true }))}
          onChange={() => {
            /* noop */
          }}
        />
      </Box>
    </Flex>
  );
}
