import { SetStateAction, useCallback, useEffect, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { DifferenceType } from "back-end/types/stats";
import { FaCheck } from "react-icons/fa";
import Dropdown from "@/components/Dropdown/Dropdown";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";

export async function analysisUpdate(
  newSettings: ExperimentSnapshotAnalysisSettings,
  analysis: ExperimentSnapshotAnalysis,
  snapshot: ExperimentSnapshotInterface,
  apiCall: <T>(
    url: string | null,
    options?: RequestInit | undefined
  ) => Promise<T>,
  setPostLoading: (value: SetStateAction<boolean>) => void,
  phase?: number
): Promise<"success" | "fail" | "abort"> {
  if (!analysis || !snapshot) return "abort";
  let status: "success" | "fail" | "abort" = "fail";

  if (!getSnapshotAnalysis(snapshot, newSettings)) {
    setPostLoading(true);
    await apiCall(`/snapshot/${snapshot.id}/analysis`, {
      method: "POST",
      body: JSON.stringify({
        analysisSettings: newSettings,
        phaseIndex: phase,
      }),
    })
      .then((resp) => {
        // @ts-expect-error the resp should have a status
        if ((resp?.status ?? 400) + "" === "200") {
          status = "success";
        } else {
          status = "fail";
        }
      })
      .catch((e) => {
        console.error(e);
        status = "fail";
      });
  } else {
    status = "success";
  }

  return status;
}

export interface Props {
  differenceType: DifferenceType;
  setDifferenceType: (differenceType: DifferenceType) => void;
  snapshot?: ExperimentSnapshotInterface;
  phase: number;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings: (
    settings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  loading: boolean;
  mutate: () => void;
  disabled?: boolean;
}

export default function DifferenceTypeChooser({
  differenceType,
  setDifferenceType,
  snapshot,
  phase,
  analysis,
  setAnalysisSettings,
  loading,
  mutate,
  disabled,
}: Props) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [desiredDifferenceType, setDesiredDifferenceType] = useState(
    differenceType
  );
  const differenceTypeMap = new Map<DifferenceType, string>([
    ["relative", "Relative"],
    ["absolute", "Absolute"],
    ["scaled", "Scaled Impact"],
  ]);
  const selectedDifferenceName = differenceTypeMap.get(differenceType);
  const triggerAnalysisUpdate = useCallback(analysisUpdate, [
    analysis,
    snapshot,
    phase,
    apiCall,
  ]);

  useEffect(() => {
    setDesiredDifferenceType(differenceType);
  }, [differenceType]);

  const title = (
    <div className="d-inline-flex align-items-center">
      <div className={`d-flex align-items-center`}>
        <span className="hover">{selectedDifferenceName}</span>
        {((loading && differenceType !== analysis?.settings?.differenceType) ||
          postLoading) && <LoadingSpinner className="ml-1" />}
      </div>
    </div>
  );

  return (
    <div>
      <div className="uppercase-title text-muted">Difference Type</div>
      <Dropdown
        uuid={"difference-type-selector"}
        right={false}
        className="mt-2"
        toggleClassName={`d-inline-block ${
          disabled ? "" : "dropdown-underline"
        }`}
        header={<div className="h6 mb-0">Difference Type</div>}
        toggle={<div className="d-inline-flex align-items-center">{title}</div>}
        caret={!disabled}
        enabled={!disabled}
        open={open}
        setOpen={(b: boolean) => setOpen(b)}
      >
        {[...differenceTypeMap.keys()].map((newDifferenceType) => {
          const clickDifferenceType = () => {
            setDesiredDifferenceType(newDifferenceType);
            if (!snapshot) {
              setDifferenceType(newDifferenceType);
              return;
            }
            if (!analysis) return;

            const newSettings: ExperimentSnapshotAnalysisSettings = {
              ...analysis.settings,
              differenceType: newDifferenceType,
            };
            triggerAnalysisUpdate(
              newSettings,
              analysis,
              snapshot,
              apiCall,
              setPostLoading,
              phase
            ).then((status) => {
              if (status === "success") {
                setDifferenceType(newDifferenceType);
                setAnalysisSettings(newSettings);
                track("Experiment Analysis: switch difference type", {
                  differenceType: newDifferenceType,
                });
                mutate();
              } else if (status === "fail") {
                setDesiredDifferenceType(differenceType);
                mutate();
              }
              setPostLoading(false);
            });
          };

          return (
            <div
              key={newDifferenceType}
              className="d-flex align-items-center hover-highlight px-3 py-1"
            >
              <div
                className="d-flex align-items-center flex-1 cursor-pointer py-2"
                onClick={() => {
                  clickDifferenceType();
                  setOpen(false);
                }}
              >
                <div
                  className="flex align-items-center justify-content-center px-1 mr-2"
                  style={{ width: 20 }}
                >
                  {desiredDifferenceType === newDifferenceType && <FaCheck />}
                </div>
                {differenceTypeMap.get(newDifferenceType)}
              </div>
            </div>
          );
        })}
      </Dropdown>
    </div>
  );
}
