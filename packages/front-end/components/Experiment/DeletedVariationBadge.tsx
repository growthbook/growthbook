import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function DeletedVariationBadge() {
  return (
    <Tooltip body="This variation was deleted and is not active in the current phase.">
      <Badge color="red" label="Deleted" />
    </Tooltip>
  );
}
