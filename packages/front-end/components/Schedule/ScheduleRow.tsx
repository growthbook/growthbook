// Layout-only primitive for a schedule "Start"/"End" row: a fixed-width label
// column plus a slot for the row's controls (a SelectField and, conditionally, a
// DatePicker or relative-offset inputs). Callers keep their own state wiring;
// this only owns the row chrome so the layout tokens live in one place.

import { Box, Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import Text from "@/ui/Text";

const SCHEDULE_LABEL_COL_WIDTH = 70;
const SCHEDULE_ROW_MIN_HEIGHT = 54;

export default function ScheduleRow({
  label,
  labelColor,
  children,
}: {
  label: string;
  labelColor?: "text-high";
  children: ReactNode;
}) {
  return (
    <Flex
      align="center"
      gap="3"
      py="2"
      style={{ minHeight: SCHEDULE_ROW_MIN_HEIGHT }}
    >
      <Box style={{ width: SCHEDULE_LABEL_COL_WIDTH }}>
        <Text as="label" color={labelColor} weight="medium" mb="0">
          {label}
        </Text>
      </Box>
      {children}
    </Flex>
  );
}
