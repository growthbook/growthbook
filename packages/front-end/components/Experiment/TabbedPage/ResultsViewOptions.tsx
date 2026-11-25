import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentReportVariation } from "shared/types/report";
import BaselineChooserColumnLabel from "@/components/Experiment/BaselineChooserColumnLabel";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import LabelWithHelp from "@/ui/LabelWithHelp";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";

// What View Options holds beyond the filters: the baseline, which variations
// are compared to it, and which columns show.
export default function ResultsViewOptions({
  variations,
  baselineRow,
  setBaselineRow,
  variationFilter,
  setVariationFilter,
  showValue,
  setShowValue,
}: {
  variations: ExperimentReportVariation[];
  baselineRow: number;
  setBaselineRow?: (baselineRow: number) => void;
  variationFilter: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
  showValue: boolean;
  setShowValue?: (show: boolean) => void;
}) {
  const { snapshot, analysis, setAnalysisSettings, mutate } = useSnapshot();
  const [baselineEl, setBaselineEl] = useState<HTMLDivElement | null>(null);
  const compared = variations
    .map((variation, index) => ({ ...variation, index }))
    .filter((v) => v.index !== baselineRow);
  const shown = compared.filter((v) => !variationFilter.includes(v.index));

  return (
    <>
      {setBaselineRow ? (
        <Box mt="4" ref={setBaselineEl}>
          <Heading as="h4" size="sm" mb="2">
            <LabelWithHelp
              label="Baseline"
              help="The baseline that all variations are compared against."
            />
          </Heading>
          <BaselineChooserColumnLabel
            variations={variations}
            baselineRow={baselineRow}
            setBaselineRow={setBaselineRow}
            snapshot={snapshot}
            analysis={analysis}
            setAnalysisSettings={setAnalysisSettings}
            mutate={() => mutate({ inPlace: true })}
            dropdownEnabled={snapshot?.dimension !== "pre:date"}
            asSelect
            selectContainer={baselineEl}
          />
        </Box>
      ) : null}
      {setVariationFilter && compared.length > 1 ? (
        <Box mt="4">
          <Heading as="h4" size="sm" mb="2">
            Variations
          </Heading>
          <Flex direction="column" gap="2">
            <Text size="sm" color="text-low">
              Compared to the baseline
            </Text>
            {compared.map((v) => {
              const isShown = !variationFilter.includes(v.index);
              return (
                <Checkbox
                  key={v.index}
                  label={<VariationLabel number={v.index} name={v.name} />}
                  value={isShown}
                  // The last one shown stays: a table needs a comparison.
                  disabled={isShown && shown.length === 1}
                  setValue={(show) =>
                    setVariationFilter(
                      show
                        ? variationFilter.filter((i) => i !== v.index)
                        : [...variationFilter, v.index].sort(),
                    )
                  }
                />
              );
            })}
          </Flex>
        </Box>
      ) : null}
      {setShowValue ? (
        <Box mt="4">
          <Heading as="h4" size="sm" mb="2">
            Columns
          </Heading>
          <Checkbox
            label="Show value"
            description="Adds each variation's value, the baseline's included."
            value={showValue}
            setValue={setShowValue}
          />
        </Box>
      ) : null}
    </>
  );
}
