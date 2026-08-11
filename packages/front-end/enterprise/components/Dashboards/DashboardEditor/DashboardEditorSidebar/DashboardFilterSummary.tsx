import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

interface Props {
  // Filters carrying their own value, counted per filter not per selected value.
  customCount: number;
  onRevertAll: () => void;
}

// Inheritance roll-up above a block's settings fields. Only rendered when the
// dashboard has at least one filter the block supports.
export default function DashboardFilterSummary({
  customCount,
  onRevertAll,
}: Props) {
  const hasCustom = customCount > 0;

  return (
    <Flex justify="between" align="center" gap="3">
      {hasCustom ? (
        <Badge
          label={`Custom filters: ${customCount}`}
          color="violet"
          variant="soft"
          radius="medium"
        />
      ) : (
        <Badge
          label="Following dashboard filters"
          color="green"
          variant="soft"
          radius="medium"
        />
      )}
      {hasCustom ? (
        // Link's "bold" is the same weight Text calls "semibold".
        <Link size="sm" weight="bold" onClick={onRevertAll}>
          Revert all to dashboard
        </Link>
      ) : (
        // Greyed out rather than hidden, so the row doesn't reflow.
        <Text size="sm" weight="semibold" color="text-low">
          Revert all to dashboard
        </Text>
      )}
    </Flex>
  );
}
