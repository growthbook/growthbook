import { Box, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { PiArrowSquareOutBold, PiShuffle } from "react-icons/pi";
import { TbCloudOff } from "react-icons/tb";
import { Trans, useLingui } from "@lingui/react/macro";
import React, { useMemo, useState } from "react";
import { isFactMetricId, getAllVariations } from "shared/experiments";
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
import CollapsibleDiscussion from "@/components/CollapsibleDiscussion";
import useApi from "@/hooks/useApi";

const maxImageHeight = 200;
const maxImageWidth = 300;

const NUM_PER_PAGE = 20;

const imageCache = {};

const CompletedExperimentList = ({
  experiments,
}: {
  experiments: ExperimentInterfaceStringDates[];
}) => {
  const { t } = useLingui();
  const [currentPage, setCurrentPage] = useState(1);
  const [openCarousel, setOpenCarousel] = useState<{
    experimentIndex: number;
    variationId: string;
    index: number;
  } | null>(null);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const { getOwnerDisplay } = useUser();
  const { getMetricById, getFactMetricById } = useDefinitions();

  // Batch-fetch comment counts for the current page of experiments so each
  // card doesn't fire its own discussion fetch just to render a count.
  const pageExperimentIdsKey = useMemo(
    () =>
      experiments
        .slice(start, end)
        .map((e) => e.id)
        .sort()
        .join(","),
    [experiments, start, end],
  );
  const { data: commentCountsData } = useApi<{
    counts: Record<string, number>;
  }>(`/discussions/counts/experiment?ids=${pageExperimentIdsKey}`, {
    shouldRun: () => pageExperimentIdsKey.length > 0,
  });

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
            title={t`No experiments found`}
            description={t`No stopped experiments match your search criteria. Try adjusting your filters.`}
            rightButton={null}
            leftButton={null}
          />
        ) : (
          experiments.slice(start, end).map((e, experimentIndex) => {
            const result = e.results;

            const winningVariationIndex =
              result === "lost" ? 0 : result === "won" ? (e.winner ?? 1) : null;

            const variations = getAllVariations(e);
            const winningVariation =
              winningVariationIndex !== null
                ? variations[winningVariationIndex]
                : null;

            const releasedVariationId = e.releasedVariationId || "";
            const releasedVariationIndex = variations.findIndex(
              (v) => v.id === releasedVariationId,
            );
            const releasedVariation =
              releasedVariationIndex >= 0
                ? variations[releasedVariationIndex]
                : null;

            const variantImageToShow = winningVariation
              ? winningVariationIndex
              : releasedVariation
                ? releasedVariationIndex
                : 0;

            const winningName = winningVariation?.name;
            const releasedName = releasedVariation?.name;
            const expResult = (
              <>
                {winningVariation ? (
                  <em>
                    {releasedVariation &&
                    releasedVariationId !== winningVariation.id ? (
                      <Trans>
                        <strong>{winningName}</strong> won, but{" "}
                        <strong>{releasedName}</strong> was released to 100%
                        instead
                      </Trans>
                    ) : (
                      <Trans>
                        <strong>{winningName}</strong> won and was released to
                        100%
                      </Trans>
                    )}
                  </em>
                ) : releasedVariation ? (
                  <em>
                    <Trans>
                      <strong>{releasedName}</strong> was released to 100%
                    </Trans>
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
                  body={t`Visual experiment`}
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
                  body={t`Linked Feature Flag`}
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
                  body={t`URL Redirect experiment`}
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
                  body={t`Implemented outside of GrowthBook`}
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
            const moreGoalMetricsCount = goalMetrics.length - 2;
            const resultsSummaryLabel = t`Results Summary:`;
            const originalHypothesisLabel = t`Original Hypothesis:`;
            const experimentDescriptionLabel = t`Experiment Description:`;

            const experimentProjects = e.project ? [e.project] : [];
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
                        <Trans>View experiment</Trans> <PiArrowSquareOutBold />
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
                      v={variations[variantImageToShow || 0]}
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
                            <Text weight="medium">
                              <Trans>Duration:</Trans>
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
                        </Flex>
                        <Flex gap="2">
                          <Box>
                            <Text weight="medium">
                              <Trans>Owner:</Trans>
                            </Text>
                          </Box>
                          <Box>{getOwnerDisplay(e.owner) || t`None`}</Box>
                        </Flex>
                        <Flex gap="2" align="center">
                          <Box>
                            <Text weight="medium">
                              <Trans>Type:</Trans>
                            </Text>
                          </Box>
                          <Box>
                            <Flex>{expTypes}</Flex>
                          </Box>
                        </Flex>
                      </Flex>
                      <Flex align="start" gap="0" wrap={"wrap"}>
                        <Box pr="2">
                          <Text weight="medium">
                            <Trans>Goal Metrics:</Trans>
                          </Text>
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
                              <em>
                                <Trans>None</Trans>
                              </em>
                            </Box>
                          ) : null}
                          {moreGoalMetrics ? (
                            <Box>
                              {" "}
                              <Trans>+{moreGoalMetricsCount} more</Trans>
                            </Box>
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
                              <Markdown>{`**${resultsSummaryLabel}** \n${e.analysis}`}</Markdown>
                            ) : null}

                            {e.hypothesis ? (
                              <Markdown>
                                {`**${originalHypothesisLabel}** \n${e.hypothesis}`}
                              </Markdown>
                            ) : e.description ? (
                              <Markdown>
                                {`**${experimentDescriptionLabel}** \n${e.description}`}
                              </Markdown>
                            ) : null}
                          </Flex>
                        </Box>
                      ) : (
                        <Box>
                          <em>
                            <Trans>
                              No description, hypothesis, or results summary
                            </Trans>
                          </em>
                        </Box>
                      )}
                    </Flex>
                  </Box>
                </Flex>
                <Box
                  pt="3"
                  mt="3"
                  style={{ borderTop: "1px solid var(--gray-a4)" }}
                >
                  <CollapsibleDiscussion
                    type="experiment"
                    id={e.id}
                    projects={experimentProjects}
                    commentCount={commentCountsData?.counts?.[e.id] ?? 0}
                  />
                </Box>
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
