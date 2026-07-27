import { Variation, VariationWithIndex } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PiCaretDownFill } from "react-icons/pi";
import Checkbox from "@/ui/Checkbox";
import VariationLabel from "@/ui/VariationLabel";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";

export interface VariationChooserColumnLabelProps {
  variations: Variation[] | ExperimentReportVariation[];
  variationFilter: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow: number;
  dropdownEnabled?: boolean;
  isHoldout?: boolean;
  labelMaxWidth?: number;
}

export default function VariationChooserColumnLabel({
  variations,
  variationFilter,
  setVariationFilter,
  baselineRow,
  dropdownEnabled = false,
  isHoldout = false,
  labelMaxWidth = 75,
}: VariationChooserColumnLabelProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const indexedVariations = variations.map<VariationWithIndex>((v, i) => ({
    ...v,
    index: i,
  }));

  const validVariations = indexedVariations.filter(
    (v) => v.index !== baselineRow,
  );

  const filteredVariations = validVariations.filter(
    (v) => !variationFilter.includes(v.index),
  );

  const allSelected = variationFilter.length === 0;
  const singleSelected = filteredVariations.length === 1;

  const handleToggleVariation = (variationIndex: number) => {
    if (!setVariationFilter) return;

    const isHidden = variationFilter.includes(variationIndex);
    const visibleVariations = validVariations.filter(
      (v) => !variationFilter.includes(v.index),
    );
    const isLastVisible =
      visibleVariations.length === 1 &&
      visibleVariations[0].index === variationIndex;

    if (!isHidden) {
      if (isLastVisible) {
        handleSelectAll();
      } else {
        setVariationFilter([...variationFilter, variationIndex].sort());
      }
    } else {
      setVariationFilter(variationFilter.filter((v) => v !== variationIndex));
    }
  };

  const handleSelectAll = () => {
    if (!setVariationFilter) return;
    setVariationFilter([]);
  };

  const handleSelectSingleVariation = (variationIndex: number) => {
    if (!setVariationFilter) return;
    setVariationFilter(
      validVariations
        .filter((v) => v.index !== variationIndex)
        .map((v) => v.index),
    );
  };

  const renderMenuItems = () => {
    const items: React.ReactNode[] = [];

    // "Select all" option
    if (validVariations.length > 1) {
      items.push(
        <DropdownMenuItem
          key="select-all"
          className="multiline-item"
          onClick={() => {
            handleSelectAll();
            setDropdownOpen(false);
          }}
        >
          <Flex align="center" gap="2" style={{ width: "100%" }}>
            <Flex
              align="center"
              width="20px"
              onClick={(e) => {
                // Prevent the dropdown from closing
                e.stopPropagation();
              }}
            >
              <Checkbox
                value={allSelected}
                setValue={() => {
                  if (allSelected) return;
                  handleSelectAll();
                }}
                size="sm"
                disabled={allSelected}
              />
            </Flex>
            <Text>Select All</Text>
          </Flex>
        </DropdownMenuItem>,
      );
    }

    // Variation items
    indexedVariations.forEach((variation) => {
      if (variation.index === baselineRow) return;

      const isFiltered = variationFilter.includes(variation.index);
      items.push(
        <DropdownMenuItem
          key={variation.id}
          className="multiline-item"
          onClick={() => {
            handleSelectSingleVariation(variation.index);
            setDropdownOpen(false);
          }}
        >
          <Flex align="center" gap="2" style={{ width: "100%" }}>
            <Flex
              align="center"
              width="20px"
              onClick={(e) => {
                // Prevent the dropdown from closing
                e.stopPropagation();
              }}
            >
              <Checkbox
                value={!isFiltered}
                setValue={() => {
                  handleToggleVariation(variation.index);
                }}
                size="sm"
              />
            </Flex>
            <Box style={{ maxWidth: 200, flex: 1, minWidth: 0 }}>
              <VariationLabel number={variation.index} name={variation.name} />
            </Box>
          </Flex>
        </DropdownMenuItem>,
      );
    });

    return items;
  };

  // Determine what to display in the trigger
  let triggerContent: React.ReactNode;
  if (singleSelected && !isHoldout) {
    const selectedVariation = filteredVariations[0];
    triggerContent = (
      <Box
        style={{
          width: labelMaxWidth + 20,
          maxWidth: "100%",
          minWidth: 0,
          marginLeft: -4,
        }}
      >
        <VariationLabel
          number={selectedVariation.index}
          name={selectedVariation.name}
          size="small"
          disableTooltip
        />
      </Box>
    );
  } else {
    // Multiple selected or all selected - show plain "Variation" text
    triggerContent = (
      <Text style={{ color: "var(--color-text-mid)", fontSize: "12px" }}>
        Variation
      </Text>
    );
  }

  const trigger = (
    <Tooltip
      usePortal={true}
      innerClassName={"text-left"}
      tipPosition="top"
      shouldDisplay={!dropdownOpen}
      body={
        <div style={{ lineHeight: 1.5 }}>
          {isHoldout
            ? "The variation being compared to the holdout."
            : "The variation being compared to the baseline."}
          {singleSelected && (
            <div
              className={`variation variation${filteredVariations[0]?.index} with-variation-label d-flex mt-1 align-items-top`}
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
                {filteredVariations[0]?.index}
              </span>
              <span className="font-weight-bold">
                {filteredVariations[0]?.name}
              </span>
            </div>
          )}
        </div>
      }
    >
      <Flex align="center">
        {triggerContent}
        {dropdownEnabled &&
          setVariationFilter &&
          validVariations.length > 1 && (
            <Flex align="center" gap="1">
              <PiCaretDownFill style={{ fontSize: "12px" }} />
            </Flex>
          )}
      </Flex>
    </Tooltip>
  );

  if (!dropdownEnabled || !setVariationFilter || validVariations.length <= 1) {
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
          Show Variations
        </DropdownMenuLabel>
        {renderMenuItems()}
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}
