import { FC } from "react";
import { PiInfo } from "react-icons/pi";
import { Text } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";

const OutdatedBadge: FC<{
  label?: string;
  reasons: string[];
}> = ({ label, reasons }) => {
  return (
    <Tooltip
      body={
        <div>
          {label ? (
            <div className="mb-2">
              <Text>{label}</Text>
            </div>
          ) : null}
          {reasons.length === 1 && !label ? (
            reasons[0]
          ) : reasons.length > 0 ? (
            <ul className="ml-0 pl-3 mb-0">
              {reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      }
    >
      <Badge
        label={
          <>
            Outdated
            <PiInfo size={14} />
          </>
        }
        variant="solid"
        color="yellow"
        radius="full"
      />
    </Tooltip>
  );
};
export default OutdatedBadge;
