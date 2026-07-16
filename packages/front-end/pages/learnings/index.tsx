import React, { useCallback, useState } from "react";
import { getValidDate } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { InsightWithCanManage } from "shared/validators";
import { useRouter } from "next/router";
import { PiSparkleFill } from "react-icons/pi";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { useExperiments } from "@/hooks/useExperiments";
import CompletedExperimentList from "@/components/Experiment/CompletedExperimentList";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/ui/LinkButton";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { useExperimentSearch, experimentDate } from "@/services/experiments";
import useApi from "@/hooks/useApi";
import { useAISettings } from "@/hooks/useOrgSettings";
import FindInsightsModal from "@/components/Insights/FindInsightsModal";
import SavedInsightsList from "@/components/Insights/SavedInsightsList";

const LearningsPage = (): React.ReactElement => {
  const router = useRouter();
  const { ready, project } = useDefinitions();
  const { aiEnabled } = useAISettings();

  const today = new Date();
  const [startDate, setStartDate] = useState<Date>(
    router.query["startDate"]
      ? new Date(router.query["startDate"] as string)
      : new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000), // 180 days ago
  );
  const [endDate, setEndDate] = useState<Date>(
    router.query["endDate"]
      ? new Date(router.query["endDate"] as string)
      : new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days in the future
  );
  const [findInsightsOpen, setFindInsightsOpen] = useState(false);

  function updateURL({
    startDate,
    endDate,
  }: {
    startDate: Date;
    endDate: Date;
  }) {
    const params = new URLSearchParams(window.location.search);
    params.set("startDate", startDate.toISOString().slice(0, 10));
    params.set("endDate", endDate.toISOString().slice(0, 10));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    router.replace(newUrl, undefined, { shallow: true });
  }

  const {
    experiments: allExperiments,
    error,
    loading,
  } = useExperiments(project, true, "standard");
  const allStoppedExperiments = React.useMemo(
    () => allExperiments.filter((e) => e.status === "stopped"),
    [allExperiments],
  );

  const filterResults = useCallback(
    (items: ComputedExperimentInterface[]) => {
      items = items.filter((item) => {
        const expDate = experimentDate(item);
        if (!expDate) return false;
        return (
          getValidDate(expDate) >= startDate && getValidDate(expDate) <= endDate
        );
      });
      return items;
    },
    [endDate, startDate],
  );

  const { items, searchInputProps, syntaxFilters, setSearchValue } =
    useExperimentSearch({
      allExperiments,
      filterResults,
      localStorageKey: "learnings-page",
    });

  const stoppedExperiments = React.useMemo(
    () => items.filter((e) => e.status === "stopped"),
    [items],
  );

  const { data: insightsData, mutate: mutateInsights } = useApi<{
    insights: InsightWithCanManage[];
  }>(`/insights?project=${project || ""}`);
  const insights = insightsData?.insights || [];

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }

  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const canFindInsights = aiEnabled && stoppedExperiments.length >= 2;

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-3">
          <Heading as="h1" size="2x-large" weight="medium" mb="4">
            Experiment Learnings
          </Heading>

          {allStoppedExperiments.length === 0 ? (
            <EmptyState
              title="Discover patterns in experiment outcomes"
              description="Review past experiments to learn what's working and where to experiment next."
              rightButton={null}
              leftButton={
                <LinkButton href="/experiments">Create experiment</LinkButton>
              }
            />
          ) : (
            <Tabs defaultValue="results" persistInURL={true}>
              <TabsList>
                <TabsTrigger value="results">Experiment Results</TabsTrigger>
                <TabsTrigger value="saved">
                  Saved Learnings
                  {insights.length > 0 ? ` (${insights.length})` : ""}
                </TabsTrigger>
              </TabsList>

              <Box pt="4">
                <TabsContent value="results">
                  <Box mb="4">
                    <Callout
                      status="info"
                      icon={<PiSparkleFill />}
                      contentsAs="div"
                    >
                      <Flex
                        align="center"
                        justify="between"
                        gap="3"
                        wrap="wrap"
                      >
                        <Box>
                          <Text size="medium" weight="semibold" as="div">
                            Find insights across these experiments
                          </Text>
                          <Text size="medium" color="text-mid" as="div">
                            {stoppedExperiments.length === 0 ? (
                              <>
                                AI can scan completed experiments for common
                                themes and patterns you can reuse. Run more
                                experiments or adjust the date range or remove
                                filters.
                              </>
                            ) : (
                              <>
                                Let AI scan the {stoppedExperiments.length}{" "}
                                filtered experiment
                                {stoppedExperiments.length === 1 ? "" : "s"} for
                                common themes, design tactics, and patterns you
                                can reuse.
                              </>
                            )}
                          </Text>
                        </Box>
                        <Button
                          onClick={() => setFindInsightsOpen(true)}
                          disabled={!canFindInsights}
                        >
                          <PiSparkleFill /> Find Insights
                        </Button>
                      </Flex>
                      {!aiEnabled && (
                        <Box mt="2">
                          <Text size="small" color="text-mid" as="div">
                            AI features are not enabled for this organization.
                            An admin can enable them in General Settings.
                          </Text>
                        </Box>
                      )}
                      {aiEnabled && stoppedExperiments.length === 1 && (
                        <Box mt="2">
                          <Text size="small" color="text-mid" as="div">
                            Adjust filters so at least 2 stopped experiments
                            match to find cross-experiment insights.
                          </Text>
                        </Box>
                      )}
                    </Callout>
                  </Box>
                  <Box mb="5">
                    <Flex align="center" gap="2" mb="3" justify="between">
                      <Box flexBasis="60%" flexShrink="1" flexGrow="0">
                        <Field
                          placeholder="Search..."
                          type="search"
                          {...searchInputProps}
                        />
                      </Box>
                      <Box>
                        <Flex
                          align="center"
                          gap="4"
                          justify="end"
                          flexBasis="100%"
                          style={{ fontSize: "0.8rem" }}
                        >
                          <Flex align="center">
                            <Text as="label" mr="2">
                              From
                            </Text>
                            <DatePicker
                              date={startDate}
                              setDate={(sd) => {
                                if (sd) {
                                  setStartDate(sd);
                                  updateURL({ startDate: sd, endDate });
                                }
                              }}
                              scheduleEndDate={endDate}
                              precision="date"
                              containerClassName=""
                            />
                          </Flex>
                          <Flex align="center">
                            <Text as="label" mr="2">
                              To
                            </Text>
                            <DatePicker
                              date={endDate}
                              setDate={(ed) => {
                                if (ed) {
                                  setEndDate(ed);
                                  updateURL({ startDate, endDate: ed });
                                }
                              }}
                              scheduleStartDate={startDate}
                              precision="date"
                              containerClassName=""
                            />
                          </Flex>
                        </Flex>
                      </Box>
                    </Flex>
                    <Box p="2">
                      <ExperimentSearchFilters
                        experiments={allExperiments}
                        syntaxFilters={syntaxFilters}
                        searchInputProps={searchInputProps}
                        setSearchValue={setSearchValue}
                        allowDrafts={false}
                      />
                    </Box>
                  </Box>
                  <CompletedExperimentList experiments={stoppedExperiments} />
                </TabsContent>

                <TabsContent value="saved">
                  <SavedInsightsList
                    insights={insights}
                    experiments={allExperiments}
                    newLearningProjects={project ? [project] : []}
                    mutate={mutateInsights}
                  />
                </TabsContent>
              </Box>
            </Tabs>
          )}
        </div>
      </div>

      {findInsightsOpen && (
        <FindInsightsModal
          experiments={stoppedExperiments}
          saveProjects={project ? [project] : []}
          close={() => setFindInsightsOpen(false)}
          onSaved={() => mutateInsights()}
        />
      )}
    </>
  );
};

export default LearningsPage;
