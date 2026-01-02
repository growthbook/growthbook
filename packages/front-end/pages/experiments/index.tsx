import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { PiCaretDown } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { useExperiments } from "@/hooks/useExperiments";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import LinkButton from "@/ui/LinkButton";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";
import EmptyState from "@/components/EmptyState";
import Callout from "@/ui/Callout";
import { useExperimentSearch } from "@/services/experiments";
import { useWatching } from "@/services/WatchProvider";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ExperimentsListTable from "@/components/Experiment/ExperimentsListTable";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import useURLHash from "@/hooks/useURLHash";

const ExperimentsPage = (): React.ReactElement => {
  const { ready, project } = useDefinitions();

  const [urlHash, setUrlHash] = useURLHash();
  const [tab, setTab] = useLocalStorage<string>("experiments-list-tab", "all");
  useEffect(() => {
    if (urlHash) {
      setTab(urlHash);
    }
  }, [urlHash, setTab]);
  useEffect(() => {
    setUrlHash(tab);
  }, [tab, setUrlHash]);

  const analyzeExisting = useRouter().query?.analyzeExisting === "true";

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
  } = useExperiments(project, tab === "archived", "standard");
  const { watchedExperiments } = useWatching();

  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);
  const [openImportExperimentModal, setOpenImportExperimentModal] =
    useState(false);

  const permissionsUtil = usePermissionsUtil();

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTH,
    syntaxFilters,
    setSearchValue,
  } = useExperimentSearch({
    allExperiments,
    watchedExperimentIds: watchedExperiments,
  });

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.tab] = counts[item.tab] || 0;
      counts[item.tab]++;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return tab !== "all" ? items.filter((item) => item.tab === tab) : items;
  }, [tab, items]);

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

  const hasExperiments = allExperiments.length > 0;

  // Show the View Sample Button if none of the experiments have an attached datasource
  const showViewSampleButton = !allExperiments.some((e) => e.datasource);

  const canAddExperiment = permissionsUtil.canViewExperimentModal(project);
  const canAddTemplate =
    permissionsUtil.canViewExperimentTemplateModal(project);

  const addExperimentDropdownButton = (
    <DropdownMenu
      trigger={
        <Button icon={<PiCaretDown />} iconPosition="right">
          &nbsp;Add
        </Button>
      }
      menuPlacement="end"
    >
      {canAddExperiment && (
        <DropdownMenuItem onClick={() => setOpenNewExperimentModal(true)}>
          Create New Experiment
        </DropdownMenuItem>
      )}
      {canAddExperiment && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpenImportExperimentModal(true)}>
            Import Existing Experiment
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenu>
  );

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="my-3">
          <div className="filters md-form row align-items-center">
            <div className="col-auto">
              <h1>Experiments</h1>
            </div>
            <div style={{ flex: 1 }} />
            {showViewSampleButton && <ViewSampleDataButton />}
            {(canAddExperiment || canAddTemplate) && (
              <div className="col-auto">{addExperimentDropdownButton}</div>
            )}
          </div>
          <CustomMarkdown page={"experimentList"} />
          {!hasExperiments && analyzeExisting ? (
            <EmptyState
              title="Analyze Experiment Results"
              description="Use our powerful query and stats engine to analyze experiment results using data from your warehouse."
              leftButton={
                <LinkButton
                  href="https://docs.growthbook.io/app/importing-experiments"
                  variant="outline"
                  external
                >
                  View docs
                </LinkButton>
              }
              rightButton={
                canAddExperiment && (
                  <Button onClick={() => setOpenImportExperimentModal(true)}>
                    Import Existing Experiment
                  </Button>
                )
              }
            />
          ) : !hasExperiments && !analyzeExisting ? (
            <>
              <EmptyState
                title="Create Your First Experiment"
                description="Run unlimited tests with linked feature flags, URL redirects or the Visual Editor."
                leftButton={
                  <LinkButton
                    href="https://docs.growthbook.io/experiments"
                    variant="outline"
                    external
                  >
                    View docs
                  </LinkButton>
                }
                rightButton={
                  canAddExperiment && (
                    <Button onClick={() => setOpenNewExperimentModal(true)}>
                      Create New Experiment
                    </Button>
                  )
                }
              />
              <Callout status="info">
                Want to analyze results of an existing experiment that you ran
                elsewhere?{" "}
                <Link href="/getstarted/imported-experiment-guide">
                  Learn More
                </Link>
              </Callout>
            </>
          ) : (
            hasExperiments && (
              <>
                <Tabs value={tab} onValueChange={(v) => setTab(v)}>
                  <div className="row align-items-center mb-3">
                    <div className="col-auto d-flex">
                      <TabsList>
                        <TabsTrigger value="all">All Experiments</TabsTrigger>
                        {["running", "drafts", "stopped", "archived"].map(
                          (tab, i) => {
                            if (tab === "archived" && !hasArchived) return null;

                            return (
                              <TabsTrigger value={tab} key={tab + i}>
                                <span className="mr-1 ml-2">
                                  {tab.slice(0, 1).toUpperCase()}
                                  {tab.slice(1)}
                                </span>
                                {tab !== "archived" && (
                                  <span className="badge bg-white border text-dark mr-2 mb-0">
                                    {tabCounts[tab] || 0}
                                  </span>
                                )}
                              </TabsTrigger>
                            );
                          },
                        )}
                      </TabsList>
                    </div>
                  </div>
                  <Flex
                    gap="4"
                    align="start"
                    justify="between"
                    mb="4"
                    wrap="wrap"
                  >
                    <Box flexBasis="300px" flexShrink="0">
                      <Field
                        placeholder="Search..."
                        type="search"
                        {...searchInputProps}
                      />
                    </Box>
                    <ExperimentSearchFilters
                      searchInputProps={searchInputProps}
                      syntaxFilters={syntaxFilters}
                      setSearchValue={setSearchValue}
                      experiments={allExperiments}
                    />
                  </Flex>
                  <TabsContent value="all">
                    <ExperimentsListTable
                      tab="all"
                      SortableTH={SortableTH}
                      filtered={filtered}
                      isFiltered={isFiltered}
                      project={project}
                    />
                  </TabsContent>
                  {["running", "drafts", "stopped", "archived"].map((tab) => {
                    if (tab === "archived" && !hasArchived) return null;
                    return (
                      <TabsContent value={tab} key={tab}>
                        <ExperimentsListTable
                          tab={tab}
                          SortableTH={SortableTH}
                          filtered={filtered.filter((e) => e.tab === tab)}
                          isFiltered={isFiltered}
                          project={project}
                        />
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </>
            )
          )}
        </div>
      </div>
      {openNewExperimentModal && (
        <NewExperimentForm
          onClose={() => setOpenNewExperimentModal(false)}
          source="experiment-list"
          isNewExperiment={true}
        />
      )}
      {openImportExperimentModal && (
        <ImportExperimentModal
          onClose={() => setOpenImportExperimentModal(false)}
          source="experiment-list"
        />
      )}
    </>
  );
};

export default ExperimentsPage;
