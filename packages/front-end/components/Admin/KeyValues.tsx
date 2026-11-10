import { Fragment, ReactNode } from "react";
import { Box, Grid } from "@radix-ui/themes";
import Text from "@/ui/Text";

export default function KeyValues({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    // Baseline keeps each label on the first line of a multi-line value
    <Grid
      columns="max-content minmax(0, 1fr)"
      gapX="4"
      gapY="2"
      align="baseline"
    >
      {items.map(({ label, value }) => (
        <Fragment key={label}>
          <Text color="text-mid">{label}</Text>
          <Box style={{ overflowWrap: "anywhere" }}>{value}</Box>
        </Fragment>
      ))}
    </Grid>
  );
}
