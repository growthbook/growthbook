import { Flex } from "@radix-ui/themes";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";

interface Props {
  value: boolean;
  onChange: (enabled: boolean) => void;
}

// Single opt-in/opt-out control for a block's dashboard-wide experiment filters.
// When on, every dashboard filter the block supports drives it (and those fields
// are shown read-only); when off, the block filters independently. Rendered at
// the top of every experiment block's settings form, above the first field.
export default function DashboardExperimentFilterToggle({
  value,
  onChange,
}: Props) {
  return (
    <Flex align="center" gap="1">
      <Switch
        label="Use dashboard experiment filters"
        value={value}
        onChange={onChange}
      />
      <Tooltip
        body="Follow the dashboard's experiment filters instead of this block's own settings. Turn off to filter this block independently."
        tipPosition="right"
      />
    </Flex>
  );
}
