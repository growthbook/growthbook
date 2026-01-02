import { Variation, VariationWithIndex } from "shared/types/experiment";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { FaCheck } from "react-icons/fa";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import Dropdown from "@/components/Dropdown/Dropdown";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";
import { analysisUpdate } from "./DifferenceTypeChooser";

export interface Props {
  variations: Variation[];
  baselineRow: number;
  setBaselineRow: (baselineRow: number) => void;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  mutate: () => void;
  dropdownEnabled: boolean;
}

export default function BaselineChooser({
  variations,
  baselineRow,
  setBaselineRow,
  snapshot,
  analysis,
  setAnalysisSettings,
  mutate,
  dropdownEnabled,
}: Props) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [desiredBaselineRow, setDesiredBaselineRow] = useState(baselineRow);
  // const [lastAnalysisDate, setLastAnalysisDate] = useState<Date | undefined>(
  //   undefined
  // );

  const indexedVariations = variations.map<VariationWithIndex>((v, i) => ({
    ...v,
    index: i,
  }));
  const baselineVariation =
    indexedVariations.find((v) => v.index === desiredBaselineRow) ??
    indexedVariations[0];

  const triggerAnalysisUpdate = useCallback(analysisUpdate, [
    analysis,
    snapshot,
    apiCall,
  ]);

  useEffect(() => {
    setDesiredBaselineRow(baselineRow);
  }, [baselineRow]);

  // todo: disabled logic to preserve baseline variation across manual updates. preserved for reference. remove later?
  // useEffect(() => {
  //   // detect when the snapshot is manually updated, trigger a baseline update
  //   const analysisDate = analysis?.dateCreated;
  //   if (!analysisDate) return;
  //   if (lastAnalysisDate && analysisDate <= lastAnalysisDate) return;
  //   setLastAnalysisDate(analysisDate);
  //
  //   if (analysis?.settings?.baselineVariationIndex !== desiredBaselineRow) {
  //     const newSettings: ExperimentSnapshotAnalysisSettings = {
  //       ...analysis.settings,
  //       baselineVariationIndex: desiredBaselineRow,
  //     };
  //     triggerAnalysisUpdate(desiredBaselineRow, newSettings).then((status) => {
  //       if (status === "success") {
  //         setBaselineRow(desiredBaselineRow);
  //         setVariationFilter([]);
  //         setAnalysisSettings(newSettings);
  //         mutate();
  //       } else if (status === "fail") {
  //         setDesiredBaselineRow(baselineRow);
  //         mutate();
  //       }
  //       setPostLoading(false);
  //     });
  //   }
  // }, [
  //   analysis,
  //   lastAnalysisDate,
  //   setLastAnalysisDate,
  //   setAnalysisSettings,
  //   baselineRow,
  //   setBaselineRow,
  //   desiredBaselineRow,
  //   setVariationFilter,
  //   mutate,
  //   setPostLoading,
  //   triggerAnalysisUpdate,
  // ]);

  const title = (
    <div className="d-inline-flex align-items-center">
      <div
        className={`variation variation${baselineVariation.index} with-variation-label d-flex align-items-center`}
      >
        <span className="label" style={{ width: 20, height: 20 }}>
          {baselineVariation.index}
        </span>
        <span
          className="d-inline-block text-ellipsis hover"
          style={{
            maxWidth: 150,
          }}
        >
          {baselineVariation.name}
        </span>
        {postLoading && <LoadingSpinner className="ml-1" />}
      </div>
    </div>
  );

  return (
    <div>
      <div className="uppercase-title text-muted">Baseline</div>
      <Dropdown
        uuid={"baseline-selector"}
        right={false}
        className="mt-2"
        toggleClassName={clsx("d-inline-block", {
          "dropdown-underline": dropdownEnabled,
          "dropdown-underline-disabled": !dropdownEnabled,
        })}
        header={<div className="h6 mb-0">Baseline variation</div>}
        toggle={<div className="d-inline-flex align-items-center">{title}</div>}
        caret={dropdownEnabled}
        enabled={dropdownEnabled}
        open={open}
        setOpen={(b: boolean) => setOpen(b)}
      >
        {indexedVariations.map((variation) => {
          const clickVariation = () => {
            setDesiredBaselineRow(variation.index);
            if (!snapshot) {
              setBaselineRow(variation.index);
              return;
            }
            if (!analysis) return;

            const newSettings: ExperimentSnapshotAnalysisSettings = {
              ...analysis.settings,
              baselineVariationIndex: variation.index,
            };
            triggerAnalysisUpdate(
              newSettings,
              analysis,
              snapshot,
              apiCall,
              setPostLoading,
            ).then((status) => {
              if (status === "success") {
                setBaselineRow(variation.index);
                setAnalysisSettings(newSettings);
                track("Experiment Analysis: switch baseline", {
                  baseline: variation.index,
                });
                mutate();
              } else if (status === "fail") {
                setDesiredBaselineRow(baselineRow);
                mutate();
              }
              setPostLoading(false);
            });
          };

          return (
            <div
              key={variation.id}
              className="d-flex align-items-center hover-highlight px-3 py-1"
            >
              <div
                className="d-flex align-items-center flex-1 cursor-pointer py-2"
                onClick={() => {
                  clickVariation();
                  setOpen(false);
                }}
              >
                <div
                  className="flex align-items-center justify-content-center px-1 mr-2"
                  style={{ width: 20 }}
                >
                  {baselineVariation.index === variation.index && <FaCheck />}
                </div>
                <div
                  className={`variation variation${variation.index} with-variation-label d-flex align-items-center`}
                >
                  <span
                    className="label"
                    style={{ width: 20, height: 20, flex: "none" }}
                  >
                    {variation.index}
                  </span>
                  <span
                    className="d-inline-block"
                    style={{
                      width: 150,
                      lineHeight: "14px",
                    }}
                  >
                    {variation.name}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </Dropdown>
    </div>
  );
}
