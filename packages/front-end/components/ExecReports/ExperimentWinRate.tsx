import React from "react";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import RateDial from "@/components/ExecReports/RateDial";
import Tooltip from "@/components/Tooltip/Tooltip";
import Frame from "@/components/Radix/Frame";
import ExperimentGraph from "@/components/Experiment/ExperimentGraph";

interface ExperimentWinRateProps {
  experiments: ExperimentInterfaceStringDates[];
  dateRange?: string;
  startDate?: Date;
  endDate?: Date;
  selectedProjects?: string[];
}

const ExperimentWinRate: React.FC<ExperimentWinRateProps> = ({
  experiments,
  dateRange,
  startDate,
  endDate,
  selectedProjects,
}) => {
  const wins = experiments.filter(
    (exp) => exp.status === "stopped" && exp.results === "won"
  ).length;
  const losses = experiments.filter(
    (exp) => exp.status === "stopped" && exp.results === "lost"
  ).length;
  const incon = experiments.filter(
    (exp) => exp.status === "stopped" && exp.results === "inconclusive"
  ).length;
  const total = wins + losses + incon;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  const goodPercentLow = 15;
  const goodPercentHigh = 38;

  return (
    <Frame>
      <Flex align="start" justify="between">
        <Box flexBasis="33%" flexShrink="0">
          <Heading as="h3" size="3">
            Win percentage{" "}
            <Tooltip
              body={`This shows percentage of experiments that were won vs lost or inconclusive.`}
            />
          </Heading>
          <Tooltip
            body={`A win percentage between ${goodPercentLow}% and ${goodPercentHigh}% is expected and standard.`}
          >
            <RateDial
              winRate={winRate}
              goodPercentLow={goodPercentLow}
              goodPercentHigh={goodPercentHigh}
            />
          </Tooltip>
          <Box className="appbox" p="3" mb="3">
            <Flex direction="column" gap="0" align={"center"}>
              <span>
                {dateRange === "custom" ? (
                  <>
                    From {startDate} to {endDate}
                  </>
                ) : (
                  <>In the past {dateRange} days</>
                )}
              </span>
              <span>
                {selectedProjects?.length ? (
                  <>
                    The selected projects ran {total} experiment
                    {total === 1 ? "" : "s"}
                  </>
                ) : (
                  <>
                    {total} experiment{total === 1 ? "" : "s"} were completed
                  </>
                )}
              </span>
              <span>
                {wins} won, {losses} lost, {incon} inconclusive
              </span>
            </Flex>
          </Box>
        </Box>
        <Box>
          {selectedProjects?.length ? (
            <>something for this particular project:</>
          ) : (
            <>All projects</>
          )}
          <ExperimentGraph
            resolution={"month"}
            num={12}
            height={220}
            initialShowBy={"results"}
          />
          <Box></Box>
        </Box>
      </Flex>
    </Frame>
  );
};

export default ExperimentWinRate;
