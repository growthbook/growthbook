import React from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import format from "date-fns/format";
import RateDial from "@/components/ExecReports/RateDial";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExperimentWinRateByProject from "@/components/ExecReports/ExperimentWinRateByProject";

interface ExperimentWinRateProps {
  experiments: ExperimentInterfaceStringDates[];
  dateRange: string;
  startDate: Date;
  endDate: Date;
  selectedProjects: string[];
  showProjectWinRate: boolean;
}

const ExperimentWinRate: React.FC<ExperimentWinRateProps> = ({
  experiments,
  dateRange,
  startDate,
  endDate,
  selectedProjects,
  showProjectWinRate = true,
}) => {
  const { getProjectById } = useDefinitions();
  const wins = experiments.filter(
    (exp) => exp.status === "stopped" && exp.results === "won",
  ).length;
  const losses = experiments.filter(
    (exp) => exp.status === "stopped" && exp.results === "lost",
  ).length;
  const incon = experiments.filter(
    (exp) =>
      exp.status === "stopped" &&
      exp.results !== "won" &&
      exp.results !== "lost",
  ).length;
  const total = wins + losses + incon;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  const goodPercentLow = 15;
  const goodPercentHigh = 38;

  return (
    <Box>
      <Flex align="start" justify="between">
        <Box flexBasis="100%" flexShrink="1">
          <Flex justify="between">
            <Heading as="h3" size="3">
              Win percentage{" "}
              <Tooltip
                body={`This shows percentage of experiments that were won vs lost or inconclusive.`}
              />
            </Heading>
            <Box>
              <Text weight="medium">
                {dateRange === "custom" ? (
                  <>
                    From {startDate ? format(startDate, "MMM dd yyy") : "-"} to{" "}
                    {endDate ? format(endDate, "MMM dd yyy") : "-"}
                  </>
                ) : (
                  <>Past {dateRange} days</>
                )}
              </Text>
            </Box>
          </Flex>
          <Box>
            {selectedProjects
              ? selectedProjects.map((p) => getProjectById(p)?.name).join(", ")
              : ""}
          </Box>
          <Flex width="100%" gap="3" align="center">
            {showProjectWinRate ? (
              <>
                <Flex justify="between" gap="4" width="100%">
                  <Box flexBasis="40%" flexGrow="0" flexShrink="1">
                    <Tooltip
                      body={`A win percentage between ${goodPercentLow}% and ${goodPercentHigh}% is expected and standard.`}
                    >
                      <RateDial
                        winRate={winRate}
                        goodPercentLow={goodPercentLow}
                        goodPercentHigh={goodPercentHigh}
                      />
                    </Tooltip>
                    <Box>
                      <span>
                        <>
                          Of the {total} experiment{total === 1 ? " " : "s "}
                          completed,
                        </>
                      </span>
                      <span>
                        {" "}
                        {wins} won, {losses} lost, {incon} inconclusive
                      </span>
                    </Box>
                  </Box>
                  <Box flexBasis="60%" flexGrow="1" flexShrink="0">
                    <ExperimentWinRateByProject
                      selectedProjects={selectedProjects}
                      experiments={experiments}
                    />
                  </Box>
                </Flex>
              </>
            ) : (
              <>
                <Box flexGrow="1" flexShrink="0" flexBasis="60%">
                  <Tooltip
                    body={`A win percentage between ${goodPercentLow}% and ${goodPercentHigh}% is expected and standard.`}
                  >
                    <RateDial
                      winRate={winRate}
                      goodPercentLow={goodPercentLow}
                      goodPercentHigh={goodPercentHigh}
                    />
                  </Tooltip>
                </Box>
                <Box>
                  <span>
                    <>
                      Of the {total} experiment{total === 1 ? " " : "s "}
                      completed,
                    </>
                  </span>
                  <span>
                    {" "}
                    {wins} won, {losses} lost, {incon} inconclusive
                  </span>
                </Box>
              </>
            )}
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
};

export default ExperimentWinRate;
