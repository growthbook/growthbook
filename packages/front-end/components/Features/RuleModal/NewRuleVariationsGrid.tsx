import { useState } from "react";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPlus, PiTrash } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import { getEqualWeights } from "shared/experiments";
import { parsePlainJSONObject } from "shared/util";
import FeatureValueCell from "@/components/Features/FeatureValueCell";
import { ValueDiffProvider } from "@/components/Features/ValueDiffContext";
import { PercentField } from "@/components/Forms/PercentSliderField";
import FlagValuesModal from "@/components/Experiment/TabbedPage/FlagValuesModal";
import styles from "@/components/Experiment/TabbedPage/VariationValuesTable.module.scss";
import {
  isEqualSplit,
  rebalance,
  VARIATION_WEIGHT_DECIMALS,
} from "@/services/utils";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationLabel from "@/ui/VariationLabel";
import {
  newRuleVariation,
  removeRuleVariation,
  RuleVariation,
} from "@/services/ruleVariations";
import own from "./NewRuleVariationsGrid.module.scss";

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
  const [editingValuesOf, setEditingValuesOf] = useState<string | null>(null);
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
  const canRemove = variations.length > 2;

  return (
    <Box className="appbox" mb="4" style={{ overflow: "hidden" }}>
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
            <Heading as="h4" size="sm" color="text-high" mb="0">
              Variations
            </Heading>
          </div>
          {hideSplits ? null : (
            <div className={styles.headerCell}>
              <Text weight="medium" color="text-high">
                Split
              </Text>
            </div>
          )}
          <div className={styles.headerCell}>
            <Text weight="medium" color="text-high">
              Value
            </Text>
          </div>
          <div className={clsx(styles.headerCell, lastColumn)} />

          {variations.map((v, i) => (
            <div key={v.id} className={own.row}>
              <div className={clsx(styles.cell, firstColumn)}>
                <div className={styles.fieldLine}>
                  <VariationLabel number={i} name={v.name} />
                </div>
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
                      ariaLabel={`${v.name} split`}
                    />
                  </div>
                </div>
              )}
              <div className={styles.cell}>
                <FeatureValueCell
                  id={`new-rule-value-${v.id}`}
                  value={v.value}
                  feature={feature}
                  sparse={sparse}
                  editable
                  onChange={(value) =>
                    setVariations(
                      variations.map((x) =>
                        x.id === v.id ? { ...x, value } : x,
                      ),
                    )
                  }
                  onOpenEditor={() => setEditingValuesOf(v.id)}
                  label={v.name}
                />
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
                      aria-label={`Remove ${v.name}`}
                      onClick={() => removeVariation(i)}
                    >
                      <PiTrash size={16} />
                    </IconButton>
                  </Tooltip>
                </div>
              </div>
            </div>
          ))}

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

      {editingValuesOf ? (
        <FlagValuesModal
          feature={feature}
          variations={variations.map((v, index) => ({
            id: v.id,
            name: v.name,
            index,
          }))}
          initialValues={Object.fromEntries(
            variations.map((v) => [v.id, v.value]),
          )}
          initialSparse={sparse}
          sparseEligible={
            feature.valueType === "json" &&
            parsePlainJSONObject(defaultValue) !== null
          }
          focusVariationId={editingValuesOf}
          close={() => setEditingValuesOf(null)}
          apply={({ values, sparse: nextSparse }) => {
            setVariations(
              variations.map((v) => ({ ...v, value: values[v.id] ?? v.value })),
            );
            setSparse(nextSparse);
            setEditingValuesOf(null);
          }}
        />
      ) : null}
    </Box>
  );
}
