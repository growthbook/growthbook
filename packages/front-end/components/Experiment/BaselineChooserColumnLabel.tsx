import { Variation, VariationWithIndex } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { useCallback, useEffect, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { Flex, Text } from "@radix-ui/themes";
import { PiCaretDownFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { analysisUpdate } from "@/services/snapshots";

export interface BaselineChooserColumnLabelProps {
  variations: Variation[] | ExperimentReportVariation[];
  baselineRow: number;
  setBaselineRow?: (baselineRow: number) => void;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  mutate?: () => Promise<unknown>;
  dropdownEnabled?: boolean;
  isHoldout?: boolean;
}

export default function BaselineChooserColumnLabel({
  variations,
  baselineRow,
  setBaselineRow,
  snapshot,
  analysis,
  setAnalysisSettings,
  mutate,
  dropdownEnabled,
  isHoldout = false,
}: BaselineChooserColumnLabelProps) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [desiredBaselineRow, setDesiredBaselineRow] = useState(baselineRow);

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

  const handleBaselineChange = useCallback(
    async (variationIndex: number) => {
      if (!setBaselineRow) return;

      setDesiredBaselineRow(variationIndex);
      if (!snapshot) {
        setBaselineRow(variationIndex);
        return;
      }
      if (!analysis || !setAnalysisSettings || !mutate) return;

      const newSettings: ExperimentSnapshotAnalysisSettings = {
        ...analysis.settings,
        baselineVariationIndex: variationIndex,
      };
      const status = await triggerAnalysisUpdate(
        newSettings,
        analysis,
        snapshot,
        apiCall,
        setPostLoading,
      );
      if (status === "success") {
        track("Experiment Analysis: switch baseline", {
          baseline: variationIndex,
        });
        // NB: await to ensure new analysis is available before we attempt to get it
        await mutate();
        setAnalysisSettings(newSettings);
        setBaselineRow(variationIndex);
      } else if (status === "fail") {
        setDesiredBaselineRow(baselineRow);
        mutate();
      }
      setPostLoading(false);
    },
    [
      snapshot,
      analysis,
      triggerAnalysisUpdate,
      apiCall,
      setPostLoading,
      setBaselineRow,
      setAnalysisSettings,
      mutate,
      baselineRow,
    ],
  );

  const renderMenuItems = () => {
    return indexedVariations.map((variation) => {
      return (
        <DropdownMenuItem
          key={variation.id}
          className="multiline-item"
          onClick={async () => {
            handleBaselineChange(variation.index);
            setDropdownOpen(false);
          }}
        >
          <Flex
            align="center"
            className={`variation variation${variation.index} with-variation-label`}
            style={{ maxWidth: 200, flex: 1, minWidth: 0 }}
          >
            <span
              className="label"
              style={{
                width: 20,
                height: 20,
                flex: "none",
                marginTop: "-1px",
              }}
            >
              {variation.index}
            </span>
            <Text
              style={{
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: "1.4",
              }}
            >
              {variation.name}
            </Text>
          </Flex>
        </DropdownMenuItem>
      );
    });
  };

  const trigger = (
    <Tooltip
      usePortal={true}
      innerClassName={"text-left"}
      tipPosition="top"
      shouldDisplay={!dropdownOpen}
      body={
        <div style={{ lineHeight: 1.5 }}>
          {isHoldout
            ? "The holdout variation that all variations are compared against."
            : "The baseline that all variations are compared against."}
          <div
            className={`variation variation${baselineRow} with-variation-label d-flex mt-1 align-items-top`}
            style={{ marginBottom: 2 }}
          >
            <span
              className="label mr-1"
              style={{
                width: 16,
                height: 16,
                marginTop: 2,
              }}
            >
              {baselineRow}
            </span>
            <span className="font-weight-bold">{baselineVariation.name}</span>
          </div>
        </div>
      }
    >
      <Flex align="center" gap="1">
        <Flex
          align="center"
          className={`variation variation${baselineVariation.index} with-variation-label`}
        >
          {!isHoldout && (
            <span
              className="label"
              style={{
                width: 16,
                height: 16,
                flex: "none",
                marginRight: "4px",
                marginLeft: "-4px",
              }}
            >
              {baselineVariation.index}
            </span>
          )}
          <OverflowText
            maxWidth={75}
            style={{ color: "var(--color-text-mid)", fontSize: "13px" }}
          >
            {isHoldout ? "Holdout" : baselineVariation.name}
          </OverflowText>
          {dropdownEnabled && setBaselineRow && (
            <Flex align="center" gap="1">
              <PiCaretDownFill style={{ fontSize: "12px" }} />
              {postLoading && (
                <LoadingSpinner style={{ width: "12px", height: "12px" }} />
              )}
            </Flex>
          )}
        </Flex>
      </Flex>
    </Tooltip>
  );

  if (!dropdownEnabled || !setBaselineRow) {
    return trigger;
  }

  return (
    <DropdownMenu
      trigger={<div>{trigger}</div>}
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      menuPlacement="start"
      variant="soft"
    >
      <DropdownMenuGroup>
        <DropdownMenuLabel
          textSize="1"
          textStyle={{ textTransform: "uppercase", fontWeight: 600 }}
        >
          Baseline
        </DropdownMenuLabel>
        {renderMenuItems()}
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}
