import { Flex } from "@radix-ui/themes";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";

interface Props {
  label: string;
  tooltip: string;
  value: boolean;
  onChange: (enabled: boolean) => void;
}

// Per-field opt-in for a dashboard-wide global filter. When on, this one field
// follows the dashboard's corresponding filter (and is shown read-only); when
// off, the block sets that field independently. Rendered on the right of the
// field's label row (see SidebarSettingField `accessory`).
export default function DashboardFollowToggle({
  label,
  tooltip,
  value,
  onChange,
}: Props) {
  return (
    <Flex align="center" gap="1">
      <Switch size="1" label={label} value={value} onChange={onChange} />
      <Tooltip body={tooltip} tipPosition="top" />
    </Flex>
  );
}
