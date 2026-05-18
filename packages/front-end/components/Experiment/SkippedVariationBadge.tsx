import { PiArrowBendRightDown } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";

interface Props {
  addArrow?: boolean;
}

export default function SkippedVariationBadge({ addArrow = false }: Props) {
  return (
    <Tooltip body="This variation was disabled. The traffic allocated to this variation skips the experiment but continues to be logged for analysis.">
      <Badge
        color="amber"
        label={
          <>
            {addArrow && <PiArrowBendRightDown />}
            Skipped
          </>
        }
      />
    </Tooltip>
  );
}
