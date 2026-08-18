import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";

interface Props {
  // Filter name, for the tooltip. e.g. "Metric"
  label: string;
  inherited: boolean;
  onRevert: () => void;
}

// Whether a block field follows the dashboard filter or carries its own value.
// Read-only: editing the field is what makes it Custom, Revert is the way back.
export default function DashboardFilterInheritTag({
  label,
  inherited,
  onRevert,
}: Props) {
  if (inherited) {
    return (
      <Badge
        label="Inherited"
        color="gray"
        variant="soft"
        radius="medium"
        title={`Following the dashboard's ${label} filter`}
      />
    );
  }

  return (
    <Flex align="center" gap="2">
      <Badge
        label="Custom"
        color="violet"
        variant="soft"
        radius="medium"
        title={`${label} is set just for this block`}
      />
      <Link size="sm" onClick={onRevert}>
        Revert
      </Link>
    </Flex>
  );
}
