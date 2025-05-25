import Link from "next/link";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { PiCameraLight, PiShuffle } from "react-icons/pi";
import React, { useState } from "react";
import { isFactMetricId } from "shared/experiments";
import { date } from "shared/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/components/Radix/LinkButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import AuthorizedImage from "@/components/AuthorizedImage";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Pagination from "@/components/Pagination";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Markdown from "@/components/Markdown/Markdown";
import { experimentDate } from "@/pages/experiments";

const NUM_PER_PAGE = 20;
const imageCache = {};

const CompletedExperimentList = ({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const stoppedExperiments = React.useMemo(
    () => experiments.filter((e) => e.status === "stopped"),
    [experiments]
  );
  const hasExperiments = stoppedExperiments.length > 0;

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const { getUserDisplay } = useUser();
  const { getMetricById, getFactMetricById } = useDefinitions();

  return (
    <>
      <CustomMarkdown page={"learnings"} />
      {!hasExperiments ? (
        <EmptyState
          title="Learning Library"
          description="Learn from completed experiments"
          leftButton={
            <LinkButton
              href="https://docs.growthbook.io/experiments"
              variant="outline"
              external
            >
              View docs
            </LinkButton>
          }
          rightButton={<></>}
        />
      ) : (
        hasExperiments && (
          <>
            <Box>
              {stoppedExperiments.slice(start, end).map((e) => {
                const result = e.results;

                const winningVariation = (result === "lost"
                  ? e.variations[0]
                  : result === "won"
                  ? e.variations[e.winner || 1]
                  : { name: "" }) || { name: "" };

                const winningVariationName = winningVariation?.name || "";

                const releasedVariation =
                  e.variations.find((v) => v.id === e.releasedVariationId)
                    ?.name || "";

                const expResult = (
                  <>
                    {(e.results === "won" || e.results === "lost") &&
                    winningVariationName !== releasedVariation ? (
                      <>
                        {" "}
                        but <em>{winningVariationName}</em> was released
                      </>
                    ) : null}
                    {e.results === "won" &&
                    winningVariationName &&
                    winningVariationName === releasedVariation ? (
                      <>
                        <em>{winningVariationName}</em> was released to 100%
                      </>
                    ) : (
                      <>{e.results === "lost" ? "reverted to control" : ""}</>
                    )}
                  </>
                );
                const expTypes: JSX.Element[] = [];
                if (e.hasVisualChangesets) {
                  expTypes.push(
                    <Tooltip
                      key={e.id + "-visual"}
                      className="d-flex align-items-center ml-2"
                      body="Visual experiment"
                    >
                      <RxDesktop className="text-blue" />
                    </Tooltip>
                  );
                }
                if ((e.linkedFeatures || []).length > 0) {
                  expTypes.push(
                    <Tooltip
                      key={e.id + "-feature-flag"}
                      className="d-flex align-items-center ml-2"
                      body="Linked Feature Flag"
                    >
                      <BsFlag className="text-blue" />
                    </Tooltip>
                  );
                }
                if (e.hasURLRedirects) {
                  expTypes.push(
                    <Tooltip
                      key={e.id + "-url-redirect"}
                      className="d-flex align-items-center ml-2"
                      body="URL Redirect experiment"
                    >
                      <PiShuffle className="text-blue" />
                    </Tooltip>
                  );
                }

                // use the image if its there, if not, use a placeholder.
                const maxImageHeight = 200;
                const maxImageWidth = 300;
                const img =
                  "screenshots" in winningVariation &&
                  winningVariation?.screenshots?.[0] ? (
                    <AuthorizedImage
                      imageCache={imageCache}
                      className="experiment-image"
                      src={winningVariation?.screenshots?.[0]?.path}
                      key={e.id + winningVariation?.screenshots?.[0]?.path}
                      style={{
                        width: maxImageWidth + "px",
                        height: maxImageHeight + "px",
                        objectFit: "contain",
                        border: "1px solid var(--slate-a6)",
                      }}
                      onErrorMsg={(msg) => {
                        return (
                          <Flex
                            title={msg}
                            align="center"
                            justify="center"
                            className="appbox mb-0"
                            width="100%"
                            style={{
                              backgroundColor: "var(--slate-a3)",
                              height: maxImageHeight + "px",
                              width: "100%",
                              color: "var(--slate-a9)",
                            }}
                          >
                            <Text size="8">
                              <PiCameraLight />
                            </Text>
                          </Flex>
                        );
                      }}
                    />
                  ) : (
                    <Flex
                      title={"no image uploaded"}
                      align="center"
                      justify="center"
                      className="appbox mb-0"
                      width="100%"
                      style={{
                        backgroundColor: "var(--slate-a3)",
                        width: maxImageWidth + "px",
                        height: maxImageHeight + "px",
                        color: "var(--slate-a9)",
                      }}
                    >
                      <Text size="8">
                        <PiCameraLight />
                      </Text>
                    </Flex>
                  );

                const goalMetrics = e.goalMetrics.map((m) => {
                  const metric = isFactMetricId(m)
                    ? getFactMetricById(m)
                    : getMetricById(m);
                  if (metric) {
                    return (
                      <Link
                        key={e.id + m}
                        href={`/metrics/${m}`}
                        className="text-decoration-none mr-3"
                      >
                        {metric.name}
                      </Link>
                    );
                  }
                  return null;
                });
                const moreGoalMetrics = e.goalMetrics.length > 2;

                return (
                  <Box
                    key={e.trackingKey}
                    className="appbox"
                    mb="4"
                    p="3"
                    px="4"
                  >
                    <Heading as="h2" size="3" mb="4">
                      <Link
                        href={`/experiment/${e.id}`}
                        className="w-100 no-link-color"
                      >
                        {e.name}
                      </Link>
                    </Heading>
                    <Flex align="start" justify="between" gap="4">
                      <Flex
                        align="start"
                        justify="start"
                        gap="5"
                        direction="column"
                      >
                        <Flex
                          align="start"
                          justify="start"
                          gap="6"
                          flexGrow="1"
                        >
                          <Box>
                            <Box mb="1">
                              <Text
                                weight="medium"
                                size="1"
                                color="gray"
                                style={{ textTransform: "uppercase" }}
                              >
                                Duration
                              </Text>
                            </Box>
                            <Box>
                              {(e.phases?.[0]?.dateStarted
                                ? date(e.phases?.[0]?.dateStarted)
                                : "") +
                                " - " +
                                (experimentDate(e)
                                  ? date(experimentDate(e))
                                  : "")}
                            </Box>
                          </Box>
                          <Box>
                            <Box mb="1">
                              <Text
                                weight="medium"
                                size="1"
                                color="gray"
                                style={{ textTransform: "uppercase" }}
                              >
                                Owner
                              </Text>
                            </Box>
                            <Box>{getUserDisplay(e.owner, false) || ""}</Box>
                          </Box>
                          <Box>
                            <Box mb="1">
                              <Text
                                weight="medium"
                                size="1"
                                color="gray"
                                style={{ textTransform: "uppercase" }}
                              >
                                Type
                              </Text>
                            </Box>
                            <Box>
                              <Flex>{expTypes}</Flex>
                            </Box>
                          </Box>
                          <Box>
                            <Box mb="1">
                              <Text
                                weight="medium"
                                size="1"
                                color="gray"
                                style={{ textTransform: "uppercase" }}
                              >
                                Goal Metrics
                              </Text>
                            </Box>
                            <Box>
                              <Flex direction="column">
                                {goalMetrics.slice(0, 2).map((g, ind) => (
                                  <Box key={e.id + "-metric-" + ind}>{g}</Box>
                                ))}
                                {moreGoalMetrics
                                  ? `and ${goalMetrics.length - 2} more`
                                  : ""}
                              </Flex>
                            </Box>
                          </Box>
                          <Box>
                            <Box mb="1">
                              <Text
                                weight="medium"
                                size="1"
                                color="gray"
                                style={{ textTransform: "uppercase" }}
                              >
                                Result
                              </Text>
                            </Box>
                            <Flex direction="column">
                              <Box mb="2">
                                <ExperimentStatusIndicator experimentData={e} />
                              </Box>
                              <Box>{expResult}</Box>
                            </Flex>
                          </Box>
                        </Flex>
                        <Flex align="start" direction="column">
                          <Box>
                            <Text
                              weight="medium"
                              color="gray"
                              size="1"
                              style={{ textTransform: "uppercase" }}
                            >
                              Summary
                            </Text>
                          </Box>
                          <Box>
                            <Markdown>{e.analysis}</Markdown>
                          </Box>
                        </Flex>
                      </Flex>
                      <Box>
                        {img ? (
                          <Flex
                            align="center"
                            justify="center"
                            direction="column"
                          >
                            <Box>
                              <Link
                                href={`/experiment/${e.id}`}
                                className="w-100 no-link-color"
                              >
                                {img}
                              </Link>
                            </Box>
                            <Box style={{ textAlign: "center" }}>
                              {winningVariationName}
                            </Box>
                          </Flex>
                        ) : (
                          <></>
                        )}
                      </Box>
                    </Flex>
                  </Box>
                );
              })}
            </Box>
            {stoppedExperiments.length > NUM_PER_PAGE && (
              <Pagination
                numItemsTotal={stoppedExperiments.length}
                currentPage={currentPage}
                perPage={NUM_PER_PAGE}
                onPageChange={setCurrentPage}
              />
            )}
          </>
        )
      )}
    </>
  );
};

export default CompletedExperimentList;
