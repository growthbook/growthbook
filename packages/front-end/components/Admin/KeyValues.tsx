import { Fragment, ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { GBEdit } from "@/components/Icons";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
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

export function EditIcon({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <GBEdit />
    </Link>
  );
}

// A detail card's title, with an edit icon when `onEdit` is given
export function CardHeading({
  title,
  onEdit,
  action,
}: {
  title: string;
  onEdit?: () => void;
  action?: ReactNode;
}) {
  return (
    <Flex align="center" justify="between" mb="3">
      <Heading as="h2" size="md" mb="0">
        {title}
      </Heading>
      {onEdit ? <EditIcon label={`Edit ${title}`} onClick={onEdit} /> : action}
    </Flex>
  );
}
