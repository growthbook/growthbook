import { Box, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { PiArrowSquareOutBold, PiShuffle } from "react-icons/pi";
import { TbCloudOff } from "react-icons/tb";
import React, { useState } from "react";
import { getLatestPhaseVariations, isFactMetricId } from "shared/experiments";
import { date } from "shared/dates";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import EmptyState from "@/components/EmptyState";
import Tooltip from "@/components/Tooltip/Tooltip";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Pagination from "@/components/Pagination";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Markdown from "@/components/Markdown/Markdown";
import Link from "@/ui/Link";
import { experimentDate } from "@/services/experiments";
import { VariationBox } from "@/components/Experiment/VariationsTable";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";

const maxImageHeight = 200;
const maxImageWidth = 300;

const NUM_PER_PAGE = 20;

const imageCache = {};

const CompletedExperimentList = ({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [openCarousel, setOpenCarousel] = useState<{
    experimentIndex: number;
    variationId: string;
    index: number;
  } | null>(null);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const { getUserDisplay } = useUser();
  const { getMetricById, getFactMetricById } = useDefinitions();

  return (
    <>
      {openCarousel && (
        <ExperimentCarouselModal
          experiment={experiments[openCarousel.experimentIndex]}
          currentVariation={openCarousel.variationId}
          currentScreenshot={openCarousel.index}
          imageCache={imageCache}
          close={() => {
            setOpenCarousel(null);
          }}
          restrictVariation={false}
        />
      )}
      <CustomMarkdown page={"learnings"} />
      <Box>
        {experiments.length === 0 ? (
          <EmptyState
            title="No experiments found"
            description="No stopped experiments match your search criteria. Try adjusting your filters."
            rightButton={null}
            leftButton={null}
          />
        ) : (
          experiments.slice(start, end).map((e, experimentIndex) => {
            const result = e.results;
            const expVariations = getLatestPhaseVariations(e);

            const winningVariationIndex =
              result === "lost" ? 0 : result === "won" ? (e.winner ?? 1) : null;

            const winningVariation =
              winningVariationIndex !== null
                ? expVariations[winningVariationIndex]
                : null;

            const releasedVariationId = e.releasedVariationId || "";
            const releasedVariationIndex = expVariations.findIndex(
              (v) => v.id === releasedVariationId,
            );
            const releasedVariation =
              releasedVariationIndex >= 0
                ? expVariations[releasedVariationIndex]
                : null;

            const variantImageToShow = winningVariation
              ? winningVariationIndex
              : releasedVariation
                ? releasedVariationIndex
                : 0;

            const expResult = (
              <>
                {winningVariation ? (
                  <em>
                    <strong>{winningVariation.name}</strong> won
                    {releasedVariation &&
                    releasedVariationId !== winningVariation.id ? (
                      <>
                        , but <strong>{releasedVariation.name}</strong> was
                        released to 100% instead
                      </>
                    ) : (
                      ` and was released to 100%`
                    )}
                  </em>
                ) : releasedVariation ? (
                  <em>
                    <strong>{releasedVariation.name}</strong> was released to
                    100%
                  </em>
                ) : null}
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
                </Tooltip>,
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
                </Tooltip>,
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
                </Tooltip>,
              );
            }

            if (expTypes.length === 0) {
              expTypes.push(
                <Tooltip
                  key={e.id + "-no-type"}
                  className="d-flex align-items-center ml-2"
                  body="Implemented outside of GrowthBook"
                >
                  <TbCloudOff className="text-blue" />
                </Tooltip>,
              );
            }

            const goalMetrics = e.goalMetrics.map((m) => {
              const metric = isFactMetricId(m)
                ? getFactMetricById(m)
                : getMetricById(m);
              if (metric) {
                return (
                  <Link
                    key={e.id + m}
                    href={`/metric/${m}`}
                    className="text-decoration-none"
                  >
                    {metric.name}
                  </Link>
                );
              }
              return null;
            });
            const moreGoalMetrics = e.goalMetrics.length > 2;

            return (
              <Box key={e.trackingKey} className="appbox" mb="4" p="6" pt="5">
                <Flex align="center" mb="4">
                  <Box flexGrow="1">
                    <Heading as="h2" size="5" mb="0">
                      <Link
                        href={`/experiment/${e.id}`}
                        className="w-100 no-link-color text-dark"
                      >
                        {e.name}
                      </Link>
                    </Heading>
                  </Box>
                  <Box>
                    <Text size="1" weight="bold">
                      <Link href={`/experiment/${e.id}`}>
                        View experiment <PiArrowSquareOutBold />
                      </Link>
                    </Text>
                  </Box>
                </Flex>
                <Flex gap="4">
                  <Box
                    width={maxImageWidth + 40 + "px"}
                    minWidth={maxImageWidth + 40 + "px"}
                  >
                    <VariationBox
                      i={variantImageToShow || 0}
                      v={expVariations[variantImageToShow || 0]}
                      experiment={e}
                      showDescription={false}
                      showIds={false}
                      height={maxImageHeight}
                      canEdit={false}
                      allowImages={true}
                      openCarousel={(variationId, index) => {
                        setOpenCarousel({
                          experimentIndex: experimentIndex + start,
                          variationId,
                          index,
                        });
                      }}
                    />
                  </Box>
                  <Box className="appbox mb-0" p="4" flexGrow="1">
                    <Flex
                      align="start"
                      justify="start"
                      gap="3"
                      flexGrow="1"
                      direction={"column"}
                    >
                      <Flex gap="2" align="center">
                        <Box>
                          <ExperimentStatusIndicator
                            experimentData={e}
                            skipArchived={true}
                          />
                        </Box>
                        <Box>{expResult}</Box>
                      </Flex>
                      <Flex gap="5" align="start" wrap={"wrap"}>
                        <Flex gap="2">
                          <Box>
                            <Text weight="medium">Duration:</Text>
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
                        </Flex>
                        <Flex gap="2">
                          <Box>
                            <Text weight="medium">Owner:</Text>
                          </Box>
                          <Box>{getUserDisplay(e.owner, false) || ""}</Box>
                        </Flex>
                        <Flex gap="2" align="center">
                          <Box>
                            <Text weight="medium">Type:</Text>
                          </Box>
                          <Box>
                            <Flex>{expTypes}</Flex>
                          </Box>
                        </Flex>
                      </Flex>
                      <Flex align="start" gap="0" wrap={"wrap"}>
                        <Box pr="2">
                          <Text weight="medium">Goal Metrics:</Text>
                        </Box>
                        <Flex gap="1">
                          {goalMetrics.slice(0, 2).map((g, ind) => (
                            <Box key={e.id + "-metric-" + ind}>
                              {g}
                              {ind < goalMetrics.length - 1 ? ", " : ""}
                            </Box>
                          ))}
                          {goalMetrics.length === 0 ? (
                            <Box>
                              <em>None</em>
                            </Box>
                          ) : null}
                          {moreGoalMetrics ? (
                            <Box> +{goalMetrics.length - 2} more</Box>
                          ) : null}
                        </Flex>
                      </Flex>
                      <Box width={"100%"}>
                        <Separator size="4" />
                      </Box>
                      {e.analysis || e.description || e.hypothesis ? (
                        <Box style={{ maxHeight: "140px", overflowY: "auto" }}>
                          <Flex direction="column" gap="3">
                            {e.analysis ? (
                              <Markdown>{`**Results Summary:** \n${e.analysis}`}</Markdown>
                            ) : null}

                            {e.hypothesis ? (
                              <Markdown>
                                {`**Original Hypothesis:** \n${e.hypothesis}`}
                              </Markdown>
                            ) : e.description ? (
                              <Markdown>
                                {`**Experiment Description:** \n${e.description}`}
                              </Markdown>
                            ) : null}
                          </Flex>
                        </Box>
                      ) : (
                        <Box>
                          <em>
                            No description, hypothesis, or results summary
                          </em>
                        </Box>
                      )}
                    </Flex>
                  </Box>
                </Flex>
              </Box>
            );
          })
        )}
      </Box>
      {experiments.length > NUM_PER_PAGE && (
        <Pagination
          numItemsTotal={experiments.length}
          currentPage={currentPage}
          perPage={NUM_PER_PAGE}
          onPageChange={setCurrentPage}
        />
      )}
    </>
  );
};

export default CompletedExperimentList;
