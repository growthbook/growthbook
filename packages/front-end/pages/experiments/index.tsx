import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiCaretDown, PiShuffle } from "react-icons/pi";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  ExperimentTemplateInterface,
} from "back-end/types/experiment";
import { Box, Switch, Text } from "@radix-ui/themes";
import { isEmpty } from "lodash";
import useOrgSettings from "@/hooks/useOrgSettings";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { useWatching } from "@/services/WatchProvider";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import LinkButton from "@/components/Radix/LinkButton";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import Button from "@/components/Radix/Button";
import TemplateForm from "@/components/Experiment/Templates/TemplateForm";
import { TemplatesPage } from "@/components/Experiment/Templates/TemplatesPage";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

const NUM_PER_PAGE = 20;

// Most actionable status have higher numbers
function getExperimentStatusSortOrder(
  e: ExperimentInterfaceStringDates
): number {
  if (e.archived) return 0;
  if (e.status === "stopped") {
    if (e.results === "dnf") return 1;
    if (e.results === "inconclusive") return 2;
    if (e.results === "lost") return 3;
    if (e.results === "won") return 4;
    return 5;
  }
  if (e.status === "draft") return 6;
  if (e.status === "running") return 7;
  return 8;
}

export function experimentDate(exp: ExperimentInterfaceStringDates): string {
  return (
    (exp.archived
      ? exp.dateUpdated
      : exp.status === "running"
      ? exp.phases?.[exp.phases?.length - 1]?.dateStarted
      : exp.status === "stopped"
      ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
      : exp.dateCreated) ?? ""
  );
}

const ExperimentsPage = (): React.ReactElement => {
  const {
    ready,
    project,
    getExperimentMetricById,
    getProjectById,
    getDatasourceById,
    getSavedGroupById,
  } = useDefinitions();

  const [tabs, setTabs] = useLocalStorage<string[]>("experiment_tabs", []);

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
  } = useExperiments(project, tabs.includes("archived"), "standard");

  const tagsFilter = useTagsFilter("experiments");
  const [showMineOnly, setShowMineOnly] = useLocalStorage(
    "showMyExperimentsOnly",
    false
  );
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);
  const [openDuplicateTemplateModal, setOpenDuplicateTemplateModal] = useState<
    undefined | ExperimentTemplateInterface
  >(undefined);
  const [openImportExperimentModal, setOpenImportExperimentModal] = useState(
    false
  );
  const [openTemplateModal, setOpenTemplateModal] = useState<
    Partial<ExperimentTemplateInterface> | undefined
  >(undefined);

  const { getUserDisplay, userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();

  const [currentPage, setCurrentPage] = useState(1);

  const experiments = useAddComputedFields(
    allExperiments,
    (exp) => {
      const projectId = exp.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;
      const statusSortOrder = getExperimentStatusSortOrder(exp);
      const lastPhase = exp.phases?.[exp.phases?.length - 1] || {};
      const rawSavedGroup = lastPhase?.savedGroups || [];
      const savedGroupIds = rawSavedGroup.map((g) => g.ids).flat();

      return {
        ownerName: getUserDisplay(exp.owner, false) || "",
        metricNames: exp.goalMetrics
          .map((m) => getExperimentMetricById(m)?.name)
          .filter(Boolean),
        datasource: getDatasourceById(exp.datasource)?.name || "",
        savedGroups: savedGroupIds.map(
          (id) => getSavedGroupById(id)?.groupName
        ),
        projectId,
        projectName,
        projectIsDeReferenced,
        tab: exp.archived
          ? "archived"
          : exp.status === "draft"
          ? "drafts"
          : exp.status,
        date: experimentDate(exp),
        statusSortOrder,
      };
    },
    [getExperimentMetricById, getProjectById, getUserDisplay]
  );

  const { watchedExperiments } = useWatching();

  const filterResults = useCallback(
    (items: typeof experiments) => {
      if (showMineOnly) {
        items = items.filter(
          (item) =>
            item.owner === userId || watchedExperiments.includes(item.id)
        );
      }

      items = filterByTags(items, tagsFilter.tags);

      return items;
    },
    [showMineOnly, userId, tagsFilter.tags, watchedExperiments]
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: experiments,
    localStorageKey: "experiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    updateSearchQueryOnChange: true,
    searchFields: [
      "name^3",
      "trackingKey^2",
      "id",
      "hypothesis^2",
      "description",
      "tags",
      "status",
      "ownerName",
      "metricNames",
      "results",
      "analysis",
    ],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        if (item.status === "draft") is.push("draft");
        if (item.status === "running") is.push("running");
        if (item.status === "stopped") is.push("stopped");
        if (item.results === "won") is.push("winner");
        if (item.results === "lost") is.push("loser");
        if (item.results === "inconclusive") is.push("inconclusive");
        if (item.hasVisualChangesets) is.push("visual");
        if (item.hasURLRedirects) is.push("redirect");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("project");
        if (item.hasVisualChangesets) {
          has.push("visualChange", "visualChanges");
        }
        if (item.hasURLRedirects) has.push("redirect", "redirects");
        if (item.linkedFeatures?.length) has.push("features", "feature");
        if (item.hypothesis?.trim()?.length) has.push("hypothesis");
        if (item.description?.trim()?.length) has.push("description");
        if (item.variations.some((v) => !!v.screenshots?.length)) {
          has.push("screenshots");
        }
        if (
          item.status === "stopped" &&
          !item.excludeFromPayload &&
          (item.linkedFeatures?.length ||
            item.hasURLRedirects ||
            item.hasVisualChangesets)
        ) {
          has.push("rollout", "tempRollout");
        }
        return has;
      },
      variations: (item) => item.variations.length,
      variation: (item) => item.variations.map((v) => v.name),
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      name: (item) => item.name,
      key: (item) => item.trackingKey,
      trackingKey: (item) => item.trackingKey,
      id: (item) => [item.id, item.trackingKey],
      status: (item) => item.status,
      result: (item) =>
        item.status === "stopped" ? item.results || "unfinished" : "unfinished",
      owner: (item) => [item.owner, item.ownerName],
      tag: (item) => item.tags,
      project: (item) => [item.project, item.projectName],
      feature: (item) => item.linkedFeatures || [],
      datasource: (item) => item.datasource,
      metric: (item) => [
        ...item.metricNames,
        ...getAllMetricIdsFromExperiment(item),
      ],
      savedgroup: (item) => item.savedGroups || [],
      goal: (item) => [...item.metricNames, ...item.goalMetrics],
    },
    filterResults,
  });

  const searchTermFilterExplainations = (
    <>
      <p>This search field supports advanced syntax search, including:</p>
      <ul>
        <li>
          <strong>name</strong>: The experiment name (eg: name:~homepage)
        </li>
        <li>
          <strong>id</strong>: The experiment id (eg: name:^exp)
        </li>
        <li>
          <strong>status</strong>: Experiment status, can be one of
          &apos;stopped&apos;, &apos;running&apos;, &apos;draft&apos;,
          &apos;archived&apos;
        </li>
        <li>
          <strong>datasource</strong>: Experiment datasource
        </li>
        <li>
          <strong>metric</strong>: Experiment uses the specified metric (eg:
          metric:~revenue)
        </li>
        <li>
          <strong>owner</strong>: The creator of the experiment (eg: owner:abby)
        </li>
        <li>
          <strong>tag</strong>: Experiments tagged with this tag
        </li>
        <li>
          <strong>project</strong>: The experiment&apos;s project
        </li>
        <li>
          <strong>feature</strong>: The experiment is linked to the specified
          feature
        </li>
        <li>
          <strong>created</strong>:The experiment&apos;s creation date, in UTC.
          Date entered is parsed so supports most formats.
        </li>
      </ul>
      <p>Click to see all syntax fields supported in our docs.</p>
    </>
  );

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.tab] = counts[item.tab] || 0;
      counts[item.tab]++;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return tabs.length
      ? items.filter((item) => tabs.includes(item.tab))
      : items;
  }, [tabs, items]);

  // If "All Projects" is selected is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && items.some((e) => e.project);

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

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

  const hasExperiments = experiments.length > 0;

  const hasTemplatesFeature = hasCommercialFeature("templates");

  const canAddExperiment = permissionsUtil.canViewExperimentModal(project);
  const canAddTemplate = permissionsUtil.canViewExperimentTemplateModal(
    project
  );

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  function onToggleTab(tab: string) {
    return () => {
      const newTabs = new Set(tabs);
      if (newTabs.has(tab)) newTabs.delete(tab);
      else newTabs.add(tab);
      setTabs([...newTabs]);
    };
  }

  const addExperimentDropdownButton = (
    <DropdownMenu
      trigger={
        <Button icon={<PiCaretDown />} iconPosition="right">
          Add
        </Button>
      }
      menuPlacement="end"
    >
      {canAddExperiment && (
        <DropdownMenuItem onClick={() => setOpenNewExperimentModal(true)}>
          Create New Experiment
        </DropdownMenuItem>
      )}
      {canAddTemplate && (
        <DropdownMenuItem
          onClick={() => setOpenTemplateModal({})}
          disabled={!hasTemplatesFeature}
        >
          <PremiumTooltip commercialFeature="templates">
            Create Template
          </PremiumTooltip>
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
        <div className="mb-3">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto">
              <h1>Experiments</h1>
            </div>
            <div style={{ flex: 1 }} />
            {settings.powerCalculatorEnabled && (
              <div className="col-auto">
                <LinkButton variant="outline" href="/power-calculator">
                  Power Calculator
                </LinkButton>
              </div>
            )}
            {(canAddExperiment || canAddTemplate) && (
              <div className="col-auto">{addExperimentDropdownButton}</div>
            )}
          </div>
          <Tabs defaultValue="experiments" persistInURL>
            <Box mb="5">
              <TabsList>
                <TabsTrigger value="experiments">Experiments</TabsTrigger>
                <TabsTrigger value="templates">
                  Templates <PaidFeatureBadge commercialFeature="templates" />
                </TabsTrigger>
              </TabsList>
            </Box>

            <TabsContent value="experiments">
              <CustomMarkdown page={"experimentList"} />
              {!hasExperiments ? (
                <div className="box py-4 text-center">
                  <div className="mx-auto mb-3" style={{ maxWidth: 650 }}>
                    <h1>Test Variations with Targeted Users</h1>
                    <Text size="3">
                      Run unlimited tests with linked feature flags, URL
                      redirects or the Visual Editor. You can also easily import
                      existing experiments from other platforms.
                    </Text>
                  </div>
                  <div
                    className="d-flex justify-content-center"
                    style={{ gap: "1rem" }}
                  >
                    <LinkButton
                      href="/getstarted/experiment-guide"
                      variant="outline"
                    >
                      Setup Instructions
                    </LinkButton>
                    {canAddExperiment && addExperimentDropdownButton}
                  </div>
                </div>
              ) : (
                <>
                  <div className="row align-items-center mb-3">
                    <div className="col-auto d-flex">
                      {["running", "drafts", "stopped", "archived"].map(
                        (tab, i) => {
                          const active = tabs.includes(tab);

                          if (tab === "archived" && !hasArchived) return null;

                          return (
                            <button
                              key={tab}
                              className={clsx("border mb-0", {
                                "badge-purple font-weight-bold": active,
                                "bg-white text-secondary": !active,
                                "rounded-left": i === 0,
                                "rounded-right":
                                  tab === "archived" ||
                                  (tab === "stopped" && !hasArchived),
                              })}
                              style={{
                                fontSize: "1em",
                                opacity: active ? 1 : 0.8,
                                padding: "6px 12px",
                              }}
                              onClick={(e) => {
                                e.preventDefault();
                                onToggleTab(tab)();
                              }}
                              title={
                                active && tabs.length > 1
                                  ? `Hide ${tab} experiments`
                                  : active
                                  ? `Remove filter`
                                  : tabs.length === 0
                                  ? `View only ${tab} experiments`
                                  : `Include ${tab} experiments`
                              }
                            >
                              <span className="mr-1 ml-2">
                                {tab.slice(0, 1).toUpperCase()}
                                {tab.slice(1)}
                              </span>
                              {tab !== "archived" && (
                                <span className="badge bg-white border text-dark mr-2 mb-0">
                                  {tabCounts[tab] || 0}
                                </span>
                              )}
                            </button>
                          );
                        }
                      )}
                    </div>
                    <div className="col-auto">
                      <Field
                        placeholder="Search..."
                        type="search"
                        {...searchInputProps}
                      />
                    </div>
                    <div className="col-auto">
                      <TagsFilter filter={tagsFilter} items={items} />
                    </div>
                    <div className="col-auto">
                      <Link
                        href="https://docs.growthbook.io/using/growthbook-best-practices#syntax-search"
                        target="_blank"
                      >
                        <Tooltip body={searchTermFilterExplainations}></Tooltip>
                      </Link>
                    </div>
                    <div className="col-auto ml-auto">
                      <Text as="label" size="1">
                        <Switch
                          checked={showMineOnly}
                          id="my-experiments-toggle"
                          onCheckedChange={(v) => setShowMineOnly(v)}
                          mr="3"
                        />
                        My Experiments Only
                      </Text>
                    </div>
                  </div>

                  <table className="appbox table experiment-table gbtable responsive-table">
                    <thead>
                      <tr>
                        <th></th>
                        <SortableTH field="name" className="w-100">
                          Experiment
                        </SortableTH>
                        {showProjectColumn && (
                          <SortableTH field="projectName">Project</SortableTH>
                        )}
                        <SortableTH field="tags">Tags</SortableTH>
                        <SortableTH field="ownerName">Owner</SortableTH>
                        <SortableTH field="date">Date</SortableTH>
                        <SortableTH
                          field="statusSortOrder"
                          style={{ minWidth: "150px" }}
                        >
                          Status
                        </SortableTH>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(start, end).map((e) => {
                        return (
                          <tr key={e.id} className="hover-highlight">
                            <td
                              data-title="Watching status:"
                              className="watching"
                            >
                              <WatchButton
                                item={e.id}
                                itemType="experiment"
                                type="icon"
                              />
                            </td>
                            <td data-title="Experiment name:" className="p-0">
                              <Link
                                href={`/experiment/${e.id}`}
                                className="d-block p-2"
                              >
                                <div className="d-flex flex-column">
                                  <div className="d-flex">
                                    <span className="testname">{e.name}</span>
                                    {e.hasVisualChangesets ? (
                                      <Tooltip
                                        className="d-flex align-items-center ml-2"
                                        body="Visual experiment"
                                      >
                                        <RxDesktop className="text-blue" />
                                      </Tooltip>
                                    ) : null}
                                    {(e.linkedFeatures || []).length > 0 ? (
                                      <Tooltip
                                        className="d-flex align-items-center ml-2"
                                        body="Linked Feature Flag"
                                      >
                                        <BsFlag className="text-blue" />
                                      </Tooltip>
                                    ) : null}
                                    {e.hasURLRedirects ? (
                                      <Tooltip
                                        className="d-flex align-items-center ml-2"
                                        body="URL Redirect experiment"
                                      >
                                        <PiShuffle className="text-blue" />
                                      </Tooltip>
                                    ) : null}
                                  </div>
                                  {isFiltered && e.trackingKey && (
                                    <span
                                      className="testid text-muted small"
                                      title="Experiment Id"
                                    >
                                      {e.trackingKey}
                                    </span>
                                  )}
                                </div>
                              </Link>
                            </td>
                            {showProjectColumn && (
                              <td className="nowrap" data-title="Project:">
                                {e.projectIsDeReferenced ? (
                                  <Tooltip
                                    body={
                                      <>
                                        Project <code>{e.project}</code> not
                                        found
                                      </>
                                    }
                                  >
                                    <span className="text-danger">
                                      Invalid project
                                    </span>
                                  </Tooltip>
                                ) : (
                                  e.projectName ?? <em>None</em>
                                )}
                              </td>
                            )}

                            <td data-title="Tags:" className="table-tags">
                              <SortedTags
                                tags={Object.values(e.tags)}
                                useFlex={true}
                              />
                            </td>
                            <td className="nowrap" data-title="Owner:">
                              {e.ownerName}
                            </td>
                            <td className="nowrap" title={datetime(e.date)}>
                              {e.tab === "running"
                                ? "started"
                                : e.tab === "drafts"
                                ? "created"
                                : e.tab === "stopped"
                                ? "ended"
                                : e.tab === "archived"
                                ? "updated"
                                : ""}{" "}
                              {date(e.date)}
                            </td>
                            <td className="nowrap" data-title="Status:">
                              <ExperimentStatusIndicator experimentData={e} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filtered.length > NUM_PER_PAGE && (
                    <Pagination
                      numItemsTotal={filtered.length}
                      currentPage={currentPage}
                      perPage={NUM_PER_PAGE}
                      onPageChange={setCurrentPage}
                    />
                  )}
                </>
              )}
            </TabsContent>
            <TabsContent value="templates">
              <TemplatesPage
                setOpenTemplateModal={setOpenTemplateModal}
                setOpenDuplicateTemplateModal={setOpenDuplicateTemplateModal}
              />
            </TabsContent>
          </Tabs>
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
      {openTemplateModal && (
        <TemplateForm
          onClose={() => setOpenTemplateModal(undefined)}
          initialValue={openTemplateModal}
          source="templates-list"
          isNewTemplate={isEmpty(openTemplateModal)}
        />
      )}
      {openDuplicateTemplateModal && (
        <TemplateForm
          onClose={() => setOpenDuplicateTemplateModal(undefined)}
          initialValue={openDuplicateTemplateModal}
          source="templates-list"
          isNewTemplate={isEmpty(openTemplateModal)}
          duplicate
        />
      )}
    </>
  );
};

export default ExperimentsPage;
