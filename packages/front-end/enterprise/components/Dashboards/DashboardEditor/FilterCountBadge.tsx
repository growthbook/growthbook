import Badge from "@/ui/Badge";

// A small count badge for filter pills. The design-system Badge at size "xs"
// (minWidth === height) renders a single digit as a circle and grows into a
// rounded pill for multi-digit counts.
export default function FilterCountBadge({ count }: { count: number }) {
  return (
    <Badge
      label={`${count}`}
      size="xs"
      radius="full"
      color="gray"
      variant="soft"
    />
  );
}
