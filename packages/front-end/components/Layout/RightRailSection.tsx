import { ReactNode, FC } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";

const RightRailSection: FC<{
  open?: () => void;
  title: string | ReactNode;
  canOpen?: boolean;
  children: ReactNode;
}> = ({ open, title, children, canOpen = false }) => {
  return (
    <div>
      <div className="d-flex justify-content-between align-items-center">
        <h4>{title}</h4>
        {open ? (
          <Tooltip
            body="You do not have permission to perform this action."
            shouldDisplay={!canOpen}
          >
            <button
              disabled={!canOpen}
              className="btn btn-link text-purple font-weight-semibold"
              onClick={(e) => {
                e.preventDefault();
                open();
              }}
            >
              Edit
            </button>
          </Tooltip>
        ) : null}
      </div>
      {children}
    </div>
  );
};

export default RightRailSection;
