import React from "react";
import {
  BlockDimensionConfig,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  blockHasFieldOfType,
} from "shared/enterprise";
import { isString, isStringArray } from "shared/util";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { PRECOMPUTED_DIMENSION_GROUP_LABEL } from "@/components/Dimensions/DimensionChooser";

interface Props {
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >;
  config: BlockDimensionConfig;
  dimensionOptions: GroupedValue[];
  dimensionValueOptions: SingleValue[];
}

// Renders the Dimension + Dimension Values selectors for a block, driven
// entirely by the block's BlockDimensionConfig (no per-block-type branches).
export default function BlockDimensionFields({
  block,
  setBlock,
  config,
  dimensionOptions,
  dimensionValueOptions,
}: Props) {
  if (!blockHasFieldOfType(block, "dimensionId", isString)) return null;

  // Restrict selectable dimensions to the configured scope. The precomputed
  // group label is produced by getDimensionOptions in DimensionChooser.
  const scopedGroups =
    config.scope === "precomputed"
      ? dimensionOptions.filter(
          (group) => group.label === PRECOMPUTED_DIMENSION_GROUP_LABEL,
        )
      : dimensionOptions;
  const hasDimensions = scopedGroups.some((group) => group.options.length > 0);
  if (config.hideWhenNoneAvailable && !hasDimensions) return null;

  // Offer an explicit "None" option (instead of a clear "X") so the control is
  // consistent with other single-selects in dashboard blocks.
  const scopedOptions: (SingleValue | GroupedValue)[] = config.allowNone
    ? [{ label: "None", value: "" }, ...scopedGroups]
    : scopedGroups;

  const dimensionSelected = block.dimensionId.length > 0;

  return (
    <>
      <SelectField
        required={config.required}
        markRequired={config.required}
        label="Dimension"
        labelClassName="font-weight-bold"
        placeholder={
          config.required
            ? "Choose which dimension to use"
            : "No dimension breakdown"
        }
        value={block.dimensionId}
        containerClassName="mb-0"
        onChange={(value) => {
          // Clearing the dimension also clears any selected levels.
          if (
            !value &&
            blockHasFieldOfType(block, "dimensionValues", isStringArray)
          ) {
            setBlock({ ...block, dimensionId: value, dimensionValues: [] });
          } else {
            setBlock({ ...block, dimensionId: value });
          }
        }}
        options={scopedOptions}
        sort={false}
      />
      {config.showValues &&
        (!config.valuesRequireSelection || dimensionSelected) &&
        blockHasFieldOfType(block, "dimensionValues", isStringArray) && (
          <MultiSelectField
            label="Dimension Values"
            labelClassName="font-weight-bold"
            placeholder="Showing all values"
            value={block.dimensionValues}
            containerClassName="mb-0"
            onChange={(value) => setBlock({ ...block, dimensionValues: value })}
            options={dimensionValueOptions}
          />
        )}
    </>
  );
}
