import { Dispatch, SetStateAction } from "react";
import { Flex } from "@radix-ui/themes";
import { getEqualWeights } from "shared/experiments";
import RadioGroup from "@/ui/RadioGroup";
import Checkbox from "@/ui/Checkbox";
import VariationSplitTable from "@/components/Experiment/VariationSplitTable";
import { rebalance } from "@/services/utils";
import Link from "@/ui/Link";

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
  usedViaRemoveVariation = false,
}: Props) {
  const removableVariations = variations.filter((v) => !v.locked);
  const maxRemovals = Math.max(0, removableVariations.length - 2);
  const selectedCount = removableVariations.filter((v) =>
    mode === "same-phase-skip"
      ? v.state === "passThrough"
      : v.state === "removed",
  ).length;

  const modeRadiosDisabled = selectedCount === 0;

  const applyEqualSplitForRerandomize = (
    next: RemoveVariationDraftVariation[],
  ): RemoveVariationDraftVariation[] => {
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

  const weightsDifferFromOriginal =
    usedViaRemoveVariation &&
    variations.some((v) => {
      if (v.state === "removed") return false;
      return Math.abs(v.weight - v.originalWeight) >= 0.0001;
    });

  const resetVariationWeights = () => {
    setVariations((current) =>
      current.map((v) => ({
        ...v,
        weight: v.state === "removed" ? 0 : v.originalWeight,
      })),
    );
  };

  return (
    <>
      <VariationSplitTable
        label="Variations to remove"
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
        suffixColumnHeader="Delete"
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
      <RadioGroup
        value={mode}
        setValue={(v: RemoveVariationMode) => setMode(v)}
        options={[
          {
            label:
              "Have disabled variation traffic skip experiment (same phase)",
            value: "same-phase-skip",
            disabled: modeRadiosDisabled || weightsDifferFromOriginal,
            description: weightsDifferFromOriginal ? (
              <span
                style={{ pointerEvents: "auto" }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Link
                  className="link-purple font-weight-bold"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resetVariationWeights();
                  }}
                >
                  Reset variation weights
                </Link>{" "}
                to match the current phase split to use this option.
              </span>
            ) : undefined,
          },
          {
            label: "Re-allocate traffic, restart experiment (new phase)",
            value: "new-phase-rerandomize",
            disabled: modeRadiosDisabled,
          },
        ]}
      />
    </>
  );
}
