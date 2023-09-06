import { useState } from "react";
import clsx from "clsx";
import DropdownLink from "@/components/Dropdown/DropdownLink";
import useGlobalMenu from "@/services/useGlobalMenu";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  coverage?: number;
}

export default function StopExperimentButton({
  editResult,
  editTargeting,
  coverage,
}: Props) {
  const [open, setOpen] = useState(false);

  useGlobalMenu(`.stop-experiment-dropdown`, () => setOpen(false));

  return (
    <div className={clsx({ "btn-group": (coverage ?? 0) === 1 })}>
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
      {(coverage ?? 0) === 1 ? (
        <>
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
              className={clsx("dropdown-menu dropdown-menu-right", {
                show: open,
              })}
            >
              <DropdownLink
                disabled={!editTargeting}
                onClick={() => {
                  editTargeting && editTargeting();
                  setOpen(false);
                }}
              >
                Adjust Targeting and Rollout {coverage}
              </DropdownLink>
            </div>
          </div>
        </>
      ) : (
        <button
          className="btn btn-primary ml-2"
          disabled={!editTargeting}
          onClick={() => {
            editTargeting && editTargeting();
            setOpen(false);
          }}
        >
          Ramp up
        </button>
      )}
    </div>
  );
}
