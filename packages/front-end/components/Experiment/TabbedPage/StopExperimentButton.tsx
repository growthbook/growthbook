import { useState } from "react";
import clsx from "clsx";
import DropdownLink from "@/components/Dropdown/DropdownLink";
import useGlobalMenu from "@/services/useGlobalMenu";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
}

export default function StopExperimentButton({
  editResult,
  editTargeting,
}: Props) {
  const [open, setOpen] = useState(false);

  useGlobalMenu(`.stop-experiment-dropdown`, () => setOpen(false));

  return (
    <div className="btn-group">
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          if (editResult) {
            editResult();
          }
        }}
        disabled={!editResult}
      >
        Stop Experiment
      </button>
      <button
        className="btn btn-primary dropdown-toggle dropdown-toggle-split stop-experiment-dropdown"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <span className="sr-only">More Options</span>
      </button>
      <div className={clsx("dropdown stop-experiment-dropdown")}>
        <div
          className={clsx("dropdown-menu dropdown-menu-right", { show: open })}
        >
          <DropdownLink
            disabled={!editTargeting}
            onClick={() => {
              editTargeting && editTargeting();
              setOpen(false);
            }}
          >
            Adjust Targeting and Rollout
          </DropdownLink>
        </div>
      </div>
    </div>
  );
}
