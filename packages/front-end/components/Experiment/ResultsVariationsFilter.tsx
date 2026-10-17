import { useEffect, useState } from "react";
import { MdFilterAlt, MdOutlineFilterAltOff } from "react-icons/md";
import { PiX } from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";

type VariationsSort = "default" | "ranked";
type FilterVariations = "all" | "5" | "3";

export default function ResultsVariationsFilter({
  variationNames,
  variationRanks,
  showVariations,
  setShowVariations,
  variationsSort,
  setVariationsSort,
  showVariationsFilter,
  setShowVariationsFilter,
}: {
  variationNames: string[];
  variationRanks: number[];
  showVariations: boolean[];
  setShowVariations: (v: boolean[]) => void;
  variationsSort: VariationsSort;
  setVariationsSort: (v: VariationsSort) => void;
  showVariationsFilter: boolean;
  setShowVariationsFilter: (show: boolean) => void;
}) {
  const [filterVariations, setFilterVariations] =
    useState<FilterVariations>("all");
  // Portals the Select into the popover, so picking an option isn't an
  // outside click that dismisses it.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

  useEffect(
    () => {
      let sv = [...showVariations];
      if (filterVariations === "all") {
        sv = variationNames.map(() => true);
        setShowVariations(sv);
        return;
      }
      if (filterVariations === "5") {
        sv = variationNames.map((_, i) => variationRanks[i] <= 5);
      } else if (filterVariations === "3") {
        sv = variationNames.map((_, i) => variationRanks[i] <= 3);
      }
      setShowVariations(sv);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterVariations],
  );

  const filteringApplied =
    filterVariations !== "all" || variationsSort !== "default";

  return (
    <Flex align="end" flexShrink="0" style={{ width: 20 }}>
      <Popover
        open={showVariationsFilter}
        onOpenChange={setShowVariationsFilter}
        side="bottom"
        align="start"
        trigger={
          <IconButton
            variant="ghost"
            color={filteringApplied ? "violet" : "gray"}
            size="1"
            aria-label="Variation filters"
          >
            <Tooltip
              content={
                filteringApplied
                  ? "Variation filters applied"
                  : "No variation filters applied"
              }
            >
              <span style={{ display: "inline-flex" }}>
                {filteringApplied ? (
                  <MdFilterAlt size={18} />
                ) : (
                  <MdOutlineFilterAltOff size={18} />
                )}
              </span>
            </Tooltip>
          </IconButton>
        }
        content={
          <Flex
            ref={setContentEl}
            direction="column"
            gap="4"
            style={{ width: 245 }}
          >
            <Box>
              <Text as="div" weight="semibold" mb="2">
                Order variations
              </Text>
              <RadioGroup
                gap="0"
                value={variationsSort}
                setValue={(v) => setVariationsSort(v as VariationsSort)}
                options={[
                  { value: "default", label: "Default order" },
                  { value: "ranked", label: "By probability" },
                ]}
              />
            </Box>

            {/* Top 3 is every variation until there are more. */}
            {variationNames.length > 3 ? (
              <Select
                label="Filter variations"
                value={filterVariations}
                setValue={(v) => setFilterVariations(v as FilterVariations)}
                container={contentEl}
              >
                <SelectItem value="all">All variations</SelectItem>
                {variationNames.length > 5 ? (
                  <SelectItem value="5">Top 5</SelectItem>
                ) : null}
                <SelectItem value="3">Top 3</SelectItem>
              </Select>
            ) : null}

            <Flex justify="between" align="center">
              {filteringApplied ? (
                <Button
                  variant="ghost"
                  color="red"
                  size="sm"
                  icon={<PiX />}
                  onClick={() => {
                    setFilterVariations("all");
                    setVariationsSort("default");
                    setShowVariationsFilter(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Box />
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowVariationsFilter(false)}
              >
                Close
              </Button>
            </Flex>
          </Flex>
        }
      />
    </Flex>
  );
}
