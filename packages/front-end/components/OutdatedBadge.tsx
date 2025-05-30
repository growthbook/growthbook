import { FC } from "react";
import { FaInfoCircle } from "react-icons/fa";
import Tooltip from "@/components/Tooltip/Tooltip";

const OutdatedBadge: FC<{
  reasons: string[];
}> = ({ reasons }) => {
  return (
    <Tooltip
      body={
        reasons.length === 1 ? (
          reasons[0]
        ) : reasons.length > 0 ? (
          <ul className="ml-0 pl-3 mb-0">
            {reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        ) : (
          ""
        )
      }
    >
      <div
        className="badge badge-warning d-block py-1"
        style={{ width: 100, marginBottom: 3 }}
      >
        Out of Date <FaInfoCircle />
      </div>
    </Tooltip>
  );
};
export default OutdatedBadge;
