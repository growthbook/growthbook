import React, { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/router";
import { useSearchParams } from "next/navigation";
import { getValidDate } from "shared/dates";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { ComputedExperimentInterface } from "shared/types/experiment";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { useExperiments } from "@/hooks/useExperiments";
import ExperimentTimeline from "@/enterprise/components/Insights/ExperimentTimeline";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import { useExperimentSearch, experimentDate } from "@/services/experiments";
import LinkButton from "@/ui/LinkButton";
import { formatDateForURL, parseDateFromURL } from "@/utils/date";

const ExperimentTimelinePage = (): React.ReactElement => {
  const router = useRouter();
  const { ready, project } = useDefinitions();
  const searchParams = useSearchParams();
  const today = new Date();
  const [startDate, setStartDate] = useState<Date>(
    searchParams.get("startDate")
      ? parseDateFromURL(searchParams.get("startDate")!)
      : new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000), // 180 days ago
  );
  const [endDate, setEndDate] = useState<Date>(
    searchParams.get("endDate")
      ? parseDateFromURL(searchParams.get("endDate")!)
      : new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days in the future
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("startDate", formatDateForURL(startDate));
    params.set("endDate", formatDateForURL(endDate));
    router.replace(`${router.pathname}?${params.toString()}`, undefined, {
      shallow: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const {
    experiments: allExperiments,
    error,
    loading,
  } = useExperiments(project, true, "standard");

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
            Experiment Timeline
          </Heading>

          {allExperiments.length === 0 ? (
            <EmptyState
              title="Experimentation Timeline"
              description="See a timeline of past experiments."
              rightButton={null}
              leftButton={
                <LinkButton href="/experiments">Create experiment</LinkButton>
              }
            />
          ) : (
            <>
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
                          if (ed) setEndDate(ed);
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
              <Box pt="5">
                <ExperimentTimeline
                  experiments={items}
                  startDate={startDate}
                  endDate={endDate}
                />
              </Box>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ExperimentTimelinePage;
