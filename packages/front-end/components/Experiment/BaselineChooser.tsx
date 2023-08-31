import { Variation, VariationWithIndex } from "back-end/types/experiment";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { FaCheck } from "react-icons/fa";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import Dropdown from "@/components/Dropdown/Dropdown";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";

export interface Props {
  variations: Variation[];
  variationFilter: number[];
  setVariationFilter: (variationFilter: number[]) => void;
  baselineRow: number;
  setBaselineRow: (baselineRow: number) => void;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings: (
    settings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  loading: boolean;
  mutate: () => void;
}

export default function BaselineChooser({
  variations,
  variationFilter,
  setVariationFilter,
  baselineRow,
  setBaselineRow,
  snapshot,
  analysis,
  setAnalysisSettings,
  loading,
  mutate,
}: Props) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [desiredBaselineRow, setDesiredBaselineRow] = useState(baselineRow);

  useEffect(() => {
    setDesiredBaselineRow(baselineRow);
  }, [baselineRow]);

  const indexedVariations = variations.map<VariationWithIndex>((v, i) => ({
    ...v,
    index: i,
  }));
  const baselineVariation =
    indexedVariations.find((v) => v.index === desiredBaselineRow) ??
    indexedVariations[0];

  // baseline selection is still WIP:
  const dropdownEnabled = true;

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
        {((loading && baselineRow > 0) || postLoading) && (
          <LoadingSpinner className="ml-1" />
        )}
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
        toggleClassName={clsx({
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
          const selectVariation = async () => {
            if (!analysis || !snapshot) return;

            setDesiredBaselineRow(variation.index);

            const oldBaselineRow = baselineRow;
            const oldVariationFilter = [...variationFilter];
            const oldAnalysisSettings = { ...analysis.settings };
            const newSettings: ExperimentSnapshotAnalysisSettings = {
              ...analysis.settings,
              baselineVariationIndex: variation.index,
            };

            if (!analysis || !snapshot) return;

            const resetFilters = () => {
              setDesiredBaselineRow(oldBaselineRow);
              setBaselineRow(oldBaselineRow);
              setVariationFilter(oldVariationFilter);
              setAnalysisSettings(oldAnalysisSettings);
              mutate();
            };

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
                  if (resp?.status !== 200) {
                    resetFilters();
                    return;
                  }
                  setBaselineRow(variation.index);
                  setVariationFilter([]);
                  setAnalysisSettings(newSettings);
                  track("Experiment Analysis: switch baseline");
                })
                .catch((e) => {
                  console.error(e);
                  resetFilters();
                });
              setPostLoading(false);
            } else {
              setBaselineRow(variation.index);
              setAnalysisSettings(newSettings);
              setVariationFilter([]);
            }
            mutate();
          };

          return (
            <div
              key={variation.id}
              className="d-flex align-items-center hover-highlight px-3 py-1"
            >
              <div
                className="d-flex align-items-center flex-1 cursor-pointer py-2"
                onClick={() => {
                  selectVariation();
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
