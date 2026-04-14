import React, { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, Separator } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { decimalToPercent } from "@/services/utils";

type VariationRowsProps = {
  experiment: ExperimentInterfaceStringDates;
  renderContent: (variationIndex: number) => ReactNode;
  renderActions?: (variationIndex: number) => ReactNode;
  alignContent?: "start" | "center";
};

export default function LinkedChangeVariationRows({
  experiment,
  renderContent,
  renderActions,
  alignContent = "start",
}: VariationRowsProps) {
  const variations = getLatestPhaseVariations(experiment);
  const latestPhase = experiment.phases?.[experiment.phases.length - 1];

  return (
    <>
      {variations.map((v, j) => (
        <React.Fragment key={v.id}>
          <Flex
            align={alignContent}
            justify="between"
            width="100%"
            gap="9"
            minHeight="24px"
          >
            <Flex
              align="center"
              gap="2"
              flexBasis="15%"
              flexShrink="0"
              className={`variation with-variation-label border-right-0 variation${j}`}
            >
              <span className="label" style={{ width: 20, height: 20 }}>
                {j}
              </span>
              <Box
                as="span"
                className="d-inline-block text-ellipsis"
                title={v.name}
              >
                <Text weight="semibold">{v.name}</Text>
              </Box>
            </Flex>
            <Flex flexBasis="90px" flexShrink="0" justify="end">
              <Text>
                {decimalToPercent(latestPhase?.variationWeights?.[j] ?? 0)}%
                Split
              </Text>
            </Flex>
            <Box flexGrow="1">{renderContent(j)}</Box>
            {renderActions && renderActions(j)}
          </Flex>
          {j < variations.length - 1 && <Separator size="4" mt="2" mb="3" />}
        </React.Fragment>
      ))}
    </>
  );
}
