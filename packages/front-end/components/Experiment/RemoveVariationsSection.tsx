import { Dispatch, SetStateAction } from "react";
import { Flex } from "@radix-ui/themes";
import { getEqualWeights } from "shared/experiments";
import RadioCards from "@/ui/RadioCards";
import Checkbox from "@/ui/Checkbox";
import VariationSplitTable from "@/components/Experiment/VariationSplitTable";
import { rebalance } from "@/services/utils";

function rebalanceExcludingRemoved(
  weights: number[],
  variations: RemoveVariationDraftVariation[],
  index: number,
  newDecimal: number,
): number[] {
  const activeIndices = variations
    .map((v, i) => (v.state === "removed" ? -1 : i))
    .filter((i): i is number => i >= 0);
  const sub = activeIndices.map((i) => weights[i]);
  const localIdx = activeIndices.indexOf(index);
  if (localIdx < 0) return weights;
  const newSub = rebalance(sub, localIdx, newDecimal);
  const out = [...weights];
  activeIndices.forEach((fi, j) => {
    out[fi] = newSub[j] ?? 0;
  });
  variations.forEach((v, i) => {
    if (v.state === "removed") out[i] = 0;
  });
  return out;
}

export type RemoveVariationMode = "same-phase-skip" | "new-phase-rerandomize";

export type RemoveVariationState = "active" | "passThrough" | "removed";

export interface RemoveVariationDraftVariation {
  id: string;
  index: number;
  name: string;
  key: string;
  originalWeight: number;
  weight: number;
  state: RemoveVariationState;
  locked: boolean;
}

interface Props {
  variations: RemoveVariationDraftVariation[];
  setVariations: Dispatch<SetStateAction<RemoveVariationDraftVariation[]>>;
  mode: RemoveVariationMode;
  setMode: (v: RemoveVariationMode) => void;
  /**
   * When true, "Same phase" cannot be selected if any weight differs from the
   * phase baseline (`originalWeight`).
   */
  usedViaRemoveVariation?: boolean;
}

export default function RemoveVariationsSection({
  variations,
  setVariations,
  mode,
  setMode,
}: Props) {
  const removableVariations = variations.filter((v) => !v.locked);
  const maxRemovals = Math.max(0, removableVariations.length - 2);
  const selectedCount = removableVariations.filter((v) =>
    mode === "same-phase-skip"
      ? v.state === "passThrough"
      : v.state === "removed",
  ).length;

  const applyEqualSplitForRerandomize = (
    next: RemoveVariationDraftVariation[],
  ): RemoveVariationDraftVariation[] => {
    const removedCount = next.filter((v) => v.state === "removed").length;
    if (removedCount === 0) {
      return next.map((v) => ({
        ...v,
        weight: v.originalWeight,
      }));
    }

    const remaining = next.filter((v) => v.state !== "removed");
    const equal = getEqualWeights(remaining.length, 4);
    let i = 0;
    return next.map((v) => {
      if (v.state === "removed") return { ...v, weight: 0 };
      return { ...v, weight: equal[i++] ?? 0 };
    });
  };

  const activeVariations = variations.filter((v) => v.state !== "removed");
  const splitsAreEqual =
    activeVariations.length <= 1
      ? true
      : activeVariations.every(
          (v) => Math.abs(v.weight - activeVariations[0].weight) < 0.0001,
        );

  const resetSelection = () => {
    setVariations((current) =>
      current.map((v) => ({
        ...v,
        state: v.locked ? "passThrough" : "active",
        weight: v.originalWeight,
      })),
    );
  };

  return (
    <>
      <RadioCards
        mb="5"
        columns="2"
        wrapText={true}
        value={mode}
        setValue={(v) => {
          const nextMode = v as RemoveVariationMode;
          if (nextMode === mode) return;
          resetSelection();
          setMode(nextMode);
        }}
        options={[
          {
            value: "same-phase-skip",
            label: "Disable and Skip Variations",
            description:
              "Units assigned to disabled variations will skip the experiment. Keep existing data for other variations.",
          },
          {
            value: "new-phase-rerandomize",
            label: "Remove Variations and Reallocate Traffic",
            description:
              "Remove selected variations and reallocate traffic to other variations, re-randomizing all traffic.",
          },
        ]}
      />
      <VariationSplitTable
        label="Select Variations to Disable"
        rows={removableVariations}
        getRowKey={(v) => v.id}
        getWeightIndex={(row) => variations.findIndex((v) => v.id === row.id)}
        weights={variations.map((v) => v.weight)}
        onApplyWeights={(next) => {
          setVariations((current) =>
            current.map((v, i) => ({
              ...v,
              weight:
                mode === "new-phase-rerandomize" && v.state === "removed"
                  ? 0
                  : (next[i] ?? v.weight),
            })),
          );
        }}
        isRowSplitEditable={(row) => row.state !== "removed"}
        rebalanceWeights={(weights, index, newDecimal) =>
          rebalanceExcludingRemoved(weights, variations, index, newDecimal)
        }
        onSetEqualWeights={() => {
          setVariations((current) => {
            const remaining = current.filter((v) => v.state !== "removed");
            const equal = getEqualWeights(remaining.length, 4);
            let i = 0;
            return current.map((v) => {
              if (v.state === "removed") return { ...v, weight: 0 };
              return { ...v, weight: equal[i++] ?? 0 };
            });
          });
        }}
        splitsAreEqual={splitsAreEqual}
        renderVariationCell={(v) => (
          <Flex
            align="center"
            className={`variation variation${v.index} with-variation-label`}
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
              {v.index}
            </span>
            <span
              style={{
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: "1.4",
              }}
            >
              {v.name}
            </span>
          </Flex>
        )}
        suffixColumnHeader={mode === "same-phase-skip" ? "Disable" : "Remove"}
        renderSuffixCell={(v) => {
          const toDelete =
            mode === "same-phase-skip"
              ? v.state === "passThrough"
              : v.state === "removed";
          const disableCheckbox = !toDelete && selectedCount >= maxRemovals;

          return (
            <Checkbox
              value={toDelete}
              size="sm"
              disabled={disableCheckbox}
              setValue={(checked) => {
                setVariations((current) => {
                  const nextDraft: RemoveVariationDraftVariation[] =
                    current.map((row) => {
                      if (row.id !== v.id) return row;
                      if (checked) {
                        return {
                          ...row,
                          state:
                            mode === "same-phase-skip"
                              ? ("passThrough" as const)
                              : ("removed" as const),
                        };
                      }
                      return { ...row, state: "active" as const };
                    });
                  return mode === "new-phase-rerandomize"
                    ? applyEqualSplitForRerandomize(nextDraft)
                    : nextDraft;
                });
              }}
            />
          );
        }}
        startEditingSplits={false}
      />
    </>
  );
}
