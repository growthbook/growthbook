import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiCaretDownFill,
  PiCaretRightFill,
  PiPlus,
  PiTrash,
} from "react-icons/pi";
import { ExperimentValue, FeatureInterface } from "shared/types/feature";
import { getEqualWeights } from "shared/experiments";
import {
  expandSparseToFull,
  generateVariationId,
  parsePlainJSONObject,
  stripDefaultsForSparse,
} from "shared/util";
import FeatureValueField from "@/components/Features/FeatureValueField";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import { ValueDiffProvider } from "@/components/Features/ValueDiffContext";
import Field from "@/components/Forms/Field";
import { PercentField } from "@/components/Forms/PercentSliderField";
import { CoverageField } from "@/components/Features/FeatureVariationsInput";
import ExperimentSplitVisual from "@/components/Features/ExperimentSplitVisual";
import { getFeatureDefaultValue } from "@/services/features";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";
import styles from "@/components/Experiment/TabbedPage/VariationValuesTable.module.scss";
import {
  isEqualSplit,
  rebalance,
  VARIATION_WEIGHT_DECIMALS,
} from "@/services/utils";
import Link from "@/ui/Link";
import Collapse from "@/ui/Collapse";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";
import {
  defaultRuleVariationName,
  newRuleVariation,
  removeRuleVariation,
  RuleVariation,
} from "@/services/ruleVariations";
import own from "./NewRuleVariationsGrid.module.scss";

/** A new rule's traffic and variations, read from and written to its form. */
export function NewRuleTrafficFields({
  kind,
  feature,
  coverageTooltip,
}: {
  kind: "experiment" | "bandit";
  feature: FeatureInterface;
  coverageTooltip: string;
}) {
  const form = useFormContext();
  const defaultValue = getFeatureDefaultValue(feature);
  const stored: (ExperimentValue & { id?: string })[] =
    form.watch("values") ?? [];
  // Each variation needs an id that holds across renders, as a row key.
  const missingIds = stored.some((v) => !v.id);
  useEffect(() => {
    if (!missingIds) return;
    form.setValue(
      "values",
      stored.map((v) => ({ ...v, id: v.id || generateVariationId() })),
    );
  }, [missingIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const variations: RuleVariation[] = stored.map((v, i) => ({
    id: v.id || String(i),
    name: v.name ?? "",
    value: v.value || "",
    weight: v.weight,
  }));
  const setVariations = (next: RuleVariation[]) =>
    form.setValue("values", next);
  const coverage = form.watch("coverage") ?? 1;
  const noun = kind === "bandit" ? "Bandit" : "experiment";

  // A Bandit's count keeps the values already set, and fills in new ones.
  const [typedCount, setTypedCount] = useState<string | null>(null);
  const applyCount = (n: number) => {
    const next = Array.from(
      { length: n },
      (_, i) =>
        variations[i] ?? newRuleVariation(feature.valueType, defaultValue, i),
    );
    setVariations(next.map((v) => ({ ...v, weight: 1 / n })));
  };
  // Applied as it's typed, so a submit by Enter uses it; clamped on blur.
  const typeCount = (raw: string) => {
    setTypedCount(raw);
    const n = parseInt(raw);
    if (n >= 2 && n <= 100 && n !== variations.length) applyCount(n);
  };
  const settleCount = (raw: string) => {
    setTypedCount(null);
    applyCount(Math.min(Math.max(2, parseInt(raw) || 2), 100));
  };
  const [valuesOpen, setValuesOpen] = useState(false);
  const grid = (
    <NewRuleVariationsGrid
      feature={feature}
      defaultValue={defaultValue}
      variations={variations}
      setVariations={setVariations}
      sparse={!!form.watch("sparse")}
      setSparse={(sparse) => form.setValue("sparse", sparse)}
      hideSplits={kind === "bandit"}
      hideAddVariation={kind === "bandit"}
    />
  );

  return (
    <>
      <CoverageField
        label={`Traffic included in this ${noun}`}
        tooltip={coverageTooltip}
        coverage={coverage}
        setCoverage={(next) => form.setValue("coverage", next)}
        disabled={false}
        panel
      >
        {kind === "experiment" ? (
          <Box pb="4">
            <ExperimentSplitVisual
              coverage={coverage}
              values={variations}
              type={feature.valueType}
            />
          </Box>
        ) : null}
      </CoverageField>
      {kind === "bandit" ? (
        <>
          <Field
            label="Number of variations"
            type="number"
            min={2}
            max={100}
            style={{ width: 120 }}
            value={typedCount ?? String(variations.length)}
            onChange={(e) => typeCount(e.target.value)}
            onBlur={(e) => settleCount(e.target.value)}
          />
          <Box mb={valuesOpen ? "0" : "6"}>
            <Link
              weight="bold"
              aria-expanded={valuesOpen}
              onClick={() => setValuesOpen(!valuesOpen)}
            >
              <Flex align="center" gap="1">
                {valuesOpen ? <PiCaretDownFill /> : <PiCaretRightFill />}
                <span>Variation values</span>
              </Flex>
            </Link>
            <Collapse open={valuesOpen}>
              <Box pt="2">{grid}</Box>
            </Collapse>
          </Box>
        </>
      ) : (
        grid
      )}
    </>
  );
}

/** A new rule's variations as the experiment page lays them out. */
export default function NewRuleVariationsGrid({
  feature,
  defaultValue,
  variations,
  setVariations,
  sparse,
  setSparse,
  hideSplits = false,
  hideAddVariation = false,
}: {
  feature: FeatureInterface;
  defaultValue: string;
  variations: RuleVariation[];
  setVariations: (variations: RuleVariation[]) => void;
  sparse: boolean;
  setSparse: (sparse: boolean) => void;
  // A Bandit sets its own weights.
  hideSplits?: boolean;
  // The count is set elsewhere.
  hideAddVariation?: boolean;
}) {
  const weights = variations.map((v) => v.weight);
  const equal = isEqualSplit(weights);

  const withWeights = (next: RuleVariation[], nextWeights: number[]) =>
    next.map((v, i) => ({ ...v, weight: nextWeights[i] ?? 0 }));
  const addVariation = () => {
    const next = [
      ...variations,
      newRuleVariation(feature.valueType, defaultValue, variations.length),
    ];
    setVariations(
      equal ? withWeights(next, getEqualWeights(next.length)) : next,
    );
  };
  const removeVariation = (index: number) =>
    setVariations(removeRuleVariation(variations, index));

  const firstColumn = styles.pinnedStart;
  const lastColumn = styles.lastColumn;
  const hasFooter = !hideAddVariation || (!hideSplits && !equal);
  const sparseEligible =
    feature.valueType === "json" && parsePlainJSONObject(defaultValue) !== null;
  // Each value is rewritten, so none is left a default-laden patch (on) or a
  // bare patch shown as the full value (off).
  const toggleSparse = (checked: boolean) => {
    setVariations(
      variations.map((v) => ({
        ...v,
        value: checked
          ? stripDefaultsForSparse(v.value, defaultValue)
          : expandSparseToFull(v.value, defaultValue),
      })),
    );
    setSparse(checked);
  };
  const canRemove = variations.length > 2;

  return (
    <Box className="appbox" mb="6" style={{ overflow: "hidden" }}>
      <ValueDiffProvider>
        <div
          className={styles.grid}
          style={{
            gridTemplateColumns: hideSplits
              ? "minmax(0, 1fr) minmax(0, 1.6fr) auto"
              : "minmax(0, 1fr) 124px minmax(0, 1.6fr) auto",
          }}
        >
          <div className={clsx(styles.headerCell, firstColumn)}>
            <Text weight="semibold">Variations</Text>
          </div>
          {hideSplits ? null : (
            <div className={styles.headerCell}>
              <Text weight="semibold">Split</Text>
            </div>
          )}
          <div className={styles.headerCell}>
            <Flex align="center" justify="between" gap="3" width="100%">
              <Text weight="semibold">Value</Text>
              {sparseEligible ? (
                <SparsePatchToggle checked={sparse} onChange={toggleSparse} />
              ) : null}
            </Flex>
          </div>
          <div className={clsx(styles.headerCell, lastColumn)} />

          {variations.map((v, i) => {
            // Blank until named, but its controls still need a name to read.
            const name = v.name || defaultRuleVariationName(i);
            return (
              <div key={v.id} className={own.row}>
                <div className={clsx(styles.cell, firstColumn)}>
                  <Flex align="center" gap="2" className={styles.fieldLine}>
                    <VariationNumber number={i} />
                    <Field
                      size="md"
                      value={v.name}
                      placeholder={defaultRuleVariationName(i)}
                      aria-label={`${name} name`}
                      containerStyle={{ flex: 1, minWidth: 0 }}
                      onChange={(e) =>
                        setVariations(
                          variations.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Flex>
                </div>
                {hideSplits ? null : (
                  <div className={styles.cell}>
                    <div className={clsx(styles.fieldLine, styles.splitField)}>
                      <PercentField
                        value={v.weight}
                        commitOn="blur"
                        decimals={VARIATION_WEIGHT_DECIMALS}
                        onChange={(weight) =>
                          setVariations(
                            withWeights(
                              variations,
                              rebalance(weights, i, weight),
                            ),
                          )
                        }
                        ariaLabel={`${name} split`}
                      />
                    </div>
                  </div>
                )}
                <div className={styles.cell}>
                  <Box width="100%" minWidth="0">
                    <FeatureValueField
                      id={`new-rule-value-${v.id}`}
                      value={v.value}
                      setValue={(value) =>
                        setVariations(
                          variations.map((x) =>
                            x.id === v.id ? { ...x, value } : x,
                          ),
                        )
                      }
                      valueType={feature.valueType}
                      feature={feature}
                      sparse={sparse}
                      renderJSONInline={false}
                      codeInputDefaultHeight={FIVE_LINES_HEIGHT}
                      useDropdown
                      compact
                      size="md"
                      fullWidth
                    />
                  </Box>
                </div>
                <div
                  className={clsx(styles.cell, lastColumn)}
                  style={{ paddingLeft: 0 }}
                >
                  <div className={styles.fieldLine}>
                    <Tooltip
                      content={
                        canRemove
                          ? "Remove variation"
                          : "Needs at least two variations"
                      }
                    >
                      <IconButton
                        type="button"
                        variant="ghost"
                        color="red"
                        radius="full"
                        size="2"
                        className={own.remove}
                        disabled={!canRemove}
                        aria-label={`Remove ${name}`}
                        onClick={() => removeVariation(i)}
                      >
                        <PiTrash size={16} />
                      </IconButton>
                    </Tooltip>
                  </div>
                </div>
              </div>
            );
          })}

          {hasFooter ? (
            <>
              <div className={clsx(styles.detailsCell, firstColumn)}>
                {hideAddVariation ? null : (
                  <div className={styles.footerLine}>
                    <Link onClick={addVariation}>
                      <Flex
                        align="center"
                        gap="1"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        <PiPlus />
                        <span className={styles.baselineText}>
                          Add variation
                        </span>
                      </Flex>
                    </Link>
                  </div>
                )}
              </div>
              {hideSplits ? null : (
                <div className={styles.detailsCell}>
                  {!equal ? (
                    <div className={styles.footerLine}>
                      <Link
                        size="sm"
                        onClick={() =>
                          setVariations(
                            withWeights(
                              variations,
                              getEqualWeights(variations.length),
                            ),
                          )
                        }
                      >
                        Set equal
                      </Link>
                    </div>
                  ) : null}
                </div>
              )}
              <div className={styles.detailsCell} />
              <div className={clsx(styles.detailsCell, lastColumn)} />
            </>
          ) : null}
        </div>
      </ValueDiffProvider>
    </Box>
  );
}
