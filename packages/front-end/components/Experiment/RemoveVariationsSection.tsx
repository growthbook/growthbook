import { Dispatch, SetStateAction } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { getEqualWeights } from "shared/experiments";
import FeatureVariationsInput from "@/components//Features/FeatureVariationsInput";
import RadioGroup from "@/ui/RadioGroup";
import Checkbox from "@/ui/Checkbox";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

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
    const remaining = next.filter((v) => v.state !== "removed");
    const equal = getEqualWeights(remaining.length, 4);
    let i = 0;
    return next.map((v) => {
      if (v.state === "removed") return { ...v, weight: 0 };
      return { ...v, weight: equal[i++] ?? 0 };
    });
  };

  return (
    <>
      <div className="mb-3">
        <label>Variations to remove</label>
        <Table size="2">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Variation</TableColumnHeader>
              <TableColumnHeader>Split</TableColumnHeader>
              <TableColumnHeader justify="center">Delete</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {removableVariations.map((v) => {
              const toDelete =
                mode === "same-phase-skip"
                  ? v.state === "passThrough"
                  : v.state === "removed";
              const disableCheckbox = !toDelete && selectedCount >= maxRemovals;

              return (
                <TableRow key={v.id}>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>{Math.round(v.originalWeight * 100)}%</TableCell>
                  <TableCell justify="center">
                    <Checkbox
                      value={toDelete}
                      size="sm"
                      disabled={disableCheckbox}
                      setValue={(checked) => {
                        setVariations((current) => {
                          const next: RemoveVariationDraftVariation[] =
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
                            ? applyEqualSplitForRerandomize(next)
                            : next;
                        });
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <RadioGroup
        value={mode}
        setValue={(v: RemoveVariationMode) => setMode(v)}
        options={[
          {
            label:
              "Same phase, traffic in disabled variations will skip the experiment",
            value: "same-phase-skip",
          },
          {
            label: "New phase, re-randomize and use all traffic",
            value: "new-phase-rerandomize",
          },
        ]}
      />
      {mode === "new-phase-rerandomize" && (
        <Box mt="4">
          <FeatureVariationsInput
            valueType={"string"}
            setWeight={(i, weight) => {
              setVariations((current) => {
                const remaining = current.filter((v) => v.state !== "removed");
                const target = remaining[i];
                if (!target) return current;
                return current.map((v) =>
                  v.id === target.id ? { ...v, weight } : v,
                );
              });
            }}
            valueAsId={true}
            variations={variations
              .filter((v) => v.state !== "removed")
              .map((v) => ({
                value: v.key || v.index + "",
                name: v.name,
                weight: v.weight,
                id: v.id,
              }))}
            showPreview={false}
            disableCoverage={true}
            hideCoverage={true}
            hideVariationIds={true}
            hideValueField={true}
            label="Variation Weights"
            startEditingSplits={false}
          />
        </Box>
      )}
    </>
  );
}
