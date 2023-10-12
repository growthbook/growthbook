import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { DifferenceType } from "back-end/types/stats";
import Dropdown from "@/components/Dropdown/Dropdown";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";

export interface Props {
  differenceType: DifferenceType;
  setDifferenceType: (differenceType: DifferenceType) => void;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings: (
    settings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  loading: boolean;
  mutate: () => void;
}

export default function DifferenceTypeChooser({
  differenceType,
  setDifferenceType,
  snapshot,
  analysis,
  setAnalysisSettings,
  loading,
  mutate,
}: Props) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [desiredDifferenceType, setDesiredDifferenceType] = useState(
    differenceType
  );
  const differenceTypes: DifferenceType[] = ["relative", "absolute"];
  const triggerAnalysisUpdate = useCallback(
    async (
      newSettings: ExperimentSnapshotAnalysisSettings
    ): Promise<"success" | "fail" | "abort"> => {
      if (!analysis || !snapshot) return "abort";
      let status: "success" | "fail" | "abort" = "fail";

      if (!getSnapshotAnalysis(snapshot, newSettings)) {
        setPostLoading(true);
        await apiCall(`/snapshot/${snapshot.id}/analysis`, {
          method: "POST",
          body: JSON.stringify({
            analysisSettings: newSettings,
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
    },
    [analysis, snapshot, apiCall]
  );

  useEffect(() => {
    setDesiredDifferenceType(differenceType);
  }, [differenceType]);

  const title = (
    <div className="d-inline-flex align-items-center">
      <div className={`d-flex align-items-center`}>
        <span className="label" style={{ width: 20, height: 20 }}>
          {differenceType}
        </span>
        {((loading && differenceType !== analysis?.settings?.differenceType) ||
          postLoading) && <LoadingSpinner className="ml-1" />}
      </div>
    </div>
  );

  return (
    <div>
      <div className="uppercase-title text-muted">Difference Type</div>
      <Dropdown
        uuid={"baseline-selector"}
        right={false}
        className="mt-2"
        toggleClassName={clsx("dropdown-underline")}
        header={<div className="h6 mb-0">Difference Type</div>}
        toggle={<div className="d-inline-flex align-items-center">{title}</div>}
        caret={true}
        enabled={true}
        open={open}
        setOpen={(b: boolean) => setOpen(b)}
      >
        {differenceTypes.map((newDifferenceType) => {
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
            triggerAnalysisUpdate(newSettings).then((status) => {
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
                {newDifferenceType}
              </div>
            </div>
          );
        })}
      </Dropdown>
    </div>
  );
}
