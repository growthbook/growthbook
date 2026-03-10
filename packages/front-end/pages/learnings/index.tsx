import React, { useCallback, useState } from "react";
import { getValidDate } from "shared/dates";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { useExperiments } from "@/hooks/useExperiments";
import CompletedExperimentList from "@/components/Experiment/CompletedExperimentList";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/ui/LinkButton";
import { useExperimentSearch, experimentDate } from "@/services/experiments";

const LearningsPage = (): React.ReactElement => {
  const router = useRouter();

  const { ready, project } = useDefinitions();

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

  function updateURL({
    startDate,
    endDate,
  }: {
    startDate: Date;
    endDate: Date;
  }) {
    const params = new URLSearchParams(window.location.search);
    params.set("startDate", startDate.toISOString().slice(0, 10)); // Keep only YYYY-MM-DD
    params.set("endDate", endDate.toISOString().slice(0, 10)); // Keep only YYYY-MM-DD
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
      // only show experiments that are within the date range
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
    });

  const stoppedExperiments = React.useMemo(
    () => items.filter((e) => e.status === "stopped"),
    [items],
  );

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-3">
          <Heading size="7" style={{ fontWeight: 500 }} mb="4">
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
            <>
              <Box mb="5">
                <Flex align="center" gap="2" className="mb-3" justify="between">
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
                      style={{
                        fontSize: "0.8rem",
                      }}
                    >
                      <Flex align="center">
                        <label className="mb-0 mr-2">From</label>
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
                        <label className="mb-0 mr-2">To</label>
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
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default LearningsPage;
