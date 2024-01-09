import { HiBadgeCheck } from "react-icons/hi";
import Tooltip from "../Tooltip/Tooltip";

export default function OfficialBadge({ type }: { type: string }) {
  return (
    <span className="ml-1 text-purple">
      <Tooltip
        body={
          <>
            This is an <strong>Official</strong> {type} and is defined in the{" "}
            <code>config.yml</code> file. It cannot be edited within the
            GrowthBook UI.
          </>
        }
      >
        <HiBadgeCheck />
      </Tooltip>
    </span>
  );
}
