import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiShuffle } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { ComputedExperimentInterface } from "shared/types/experiment";
import LoadingOverlay from "@/components/LoadingOverlay";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import { tagFilterOnClick, tagLinkProps } from "@/services/search";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
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
import ContextualBanditForm from "@/enterprise/components/ContextualBandit/ContextualBanditForm";
import Button from "@/ui/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LinkButton from "@/ui/LinkButton";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { useExperimentSearch } from "@/services/experiments";
import Callout from "@/ui/Callout";

const NUM_PER_PAGE = 20;

const ContextualBanditsPage = (): React.ReactElement => {
  const { ready, project, projects } = useDefinitions();

  const [tabs, setTabs] = useLocalStorage<string[]>(
    "contextual_bandit_tabs",
    [],
  );

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
  } = useExperiments(project, tabs.includes("archived"), "contextual-bandit");

  const tagsFilter = useTagsFilter("contextual-bandits");
  const [showMineOnly, setShowMineOnly] = useLocalStorage(
    "showMyContextualBanditsOnly",
    false,
  );
  const [openNewModal, setOpenNewModal] = useState(false);

  const { userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [currentPage, setCurrentPage] = useState(1);

  const { watchedExperiments } = useWatching();

  const filterResults = useCallback(
    (items: ComputedExperimentInterface[]) => {
      if (showMineOnly) {
        items = items.filter(
          (item) =>
            item.owner === userId || watchedExperiments.includes(item.id),
        );
      }

      items = filterByTags(items, tagsFilter.tags);

      return items;
    },
    [showMineOnly, userId, tagsFilter.tags, watchedExperiments],
  );

  const { items, searchInputProps, isFiltered, SortableTH, setSearchValue } =
    useExperimentSearch({
      allExperiments,
      filterResults,
      localStorageKey: "contextual-bandits-page",
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
    return tabs.length
      ? items.filter((item) => tabs.includes(item.tab))
      : items;
  }, [tabs, items]);

  const showProjectColumn = !project && items.some((e) => e.project);

  const hasContextualBanditFeature = hasCommercialFeature("contextual-bandits");

  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = allExperiments.length > 0;

  const canAdd = permissionsUtil.canViewExperimentModal(project, projects);

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

  if (!hasContextualBanditFeature) {
    return (
      <Box className="contents pagecontents">
        <PremiumEmptyState
          h1="Contextual Bandits"
          title="Run Context-Aware Adaptive Experiments with Contextual Bandits"
          description="Contextual Bandits automatically guide more traffic to better variants based on user context."
          commercialFeature="contextual-bandits"
          learnMoreLink="https://docs.growthbook.io/bandits/overview"
        />
      </Box>
    );
  }

  return (
    <>
      <Box className="contents experiments pagecontents">
        <Box mb="3" mt="2">
          <Flex
            className="filters md-form"
            align="center"
            mb="3"
            gap="3"
            wrap="wrap"
          >
            <Flex align="center" flexGrow="1">
              <h1>Contextual Bandits</h1>
            </Flex>
            {canAdd && (
              <PremiumTooltip
                tipPosition="left"
                commercialFeature="contextual-bandits"
              >
                <Button
                  onClick={() => {
                    setOpenNewModal(true);
                  }}
                  disabled={!hasContextualBanditFeature}
                >
                  Add Contextual Bandit
                </Button>
              </PremiumTooltip>
            )}
          </Flex>
          <CustomMarkdown page={"experimentList"} />
          {!hasExperiments ? (
            <Box className="box" py="5" style={{ textAlign: "center" }}>
              <Box mx="auto" style={{ maxWidth: 650 }}>
                <h1>Adaptively experiment with contextual bandits.</h1>
                <p>
                  Run context-aware adaptive experiments with Contextual
                  Bandits.
                </p>
              </Box>
              <Flex justify="center" pt="2" gap="4">
                <LinkButton
                  href="/getstarted/experiment-guide"
                  variant="outline"
                >
                  Setup Instructions
                </LinkButton>
                {canAdd && (
                  <PremiumTooltip
                    tipPosition="left"
                    popperStyle={{ top: 15 }}
                    commercialFeature="contextual-bandits"
                  >
                    <Button
                      onClick={() => {
                        setOpenNewModal(true);
                      }}
                      disabled={!hasContextualBanditFeature}
                    >
                      Add Contextual Bandit
                    </Button>
                  </PremiumTooltip>
                )}
              </Flex>
              <Box mt="5">
                <img
                  src="/images/empty-states/bandits.png"
                  alt="Contextual Bandits"
                  style={{ width: "100%", maxWidth: "740px", height: "auto" }}
                />
              </Box>
            </Box>
          ) : (
            <>
              <Flex align="center" mb="3" gap="3" wrap="wrap">
                <Flex align="center">
                  {["running", "drafts", "stopped", "archived"].map(
                    (tab, i) => {
                      const active = tabs.includes(tab);

                      if (tab === "archived" && !hasArchived) return null;

                      const isLast =
                        tab === "archived" ||
                        (tab === "stopped" && !hasArchived);
                      return (
                        <button
                          key={tab}
                          // badge-purple is a custom GrowthBook class; the rest
                          // has been moved into inline styles to drop Bootstrap
                          // utility classes.
                          className={clsx({
                            "badge-purple": active,
                          })}
                          style={{
                            fontSize: "1em",
                            opacity: active ? 1 : 0.8,
                            padding: "6px 12px",
                            border: "1px solid var(--color-panel-border)",
                            marginBottom: 0,
                            fontWeight: active ? 700 : undefined,
                            color: active ? undefined : "var(--color-text-mid)",
                            borderTopLeftRadius:
                              i === 0 ? "0.25rem" : undefined,
                            borderBottomLeftRadius:
                              i === 0 ? "0.25rem" : undefined,
                            borderTopRightRadius: isLast
                              ? "0.25rem"
                              : undefined,
                            borderBottomRightRadius: isLast
                              ? "0.25rem"
                              : undefined,
                            backgroundColor: active ? "" : "var(--color-panel)",
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            onToggleTab(tab)();
                          }}
                          title={
                            active && tabs.length > 1
                              ? `Hide ${tab} contextual bandits`
                              : active
                                ? `Remove filter`
                                : tabs.length === 0
                                  ? `View only ${tab} contextual bandits`
                                  : `Include ${tab} contextual bandits`
                          }
                        >
                          <span style={{ marginRight: "0.25rem" }}>
                            {tab.slice(0, 1).toUpperCase()}
                            {tab.slice(1)}
                          </span>
                          {tab !== "archived" && (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.25em 0.4em",
                                fontSize: "75%",
                                fontWeight: 700,
                                lineHeight: 1,
                                color: "var(--color-text-high)",
                                backgroundColor: "var(--color-background)",
                                border: "1px solid var(--color-panel-border)",
                                borderRadius: "0.25rem",
                                marginRight: "0.5rem",
                              }}
                            >
                              {tabCounts[tab] || 0}
                            </span>
                          )}
                        </button>
                      );
                    },
                  )}
                </Flex>
                <Box>
                  <Field
                    placeholder="Search..."
                    type="search"
                    {...searchInputProps}
                  />
                </Box>
                <Box>
                  <TagsFilter filter={tagsFilter} items={items} />
                </Box>
                <Box style={{ marginLeft: "auto" }}>
                  <Switch
                    id="my-contextual-bandits-toggle"
                    label="My Contextual Bandits Only"
                    value={showMineOnly}
                    onChange={(value) => {
                      setShowMineOnly(value);
                    }}
                  />
                </Box>
              </Flex>

              <table className="appbox table experiment-table gbtable responsive-table">
                <thead>
                  <tr>
                    <th></th>
                    <SortableTH field="name" className="w-100">
                      Contextual Bandit
                    </SortableTH>
                    {showProjectColumn && (
                      <SortableTH field="projectName">Project</SortableTH>
                    )}
                    <SortableTH field="tags">Tags</SortableTH>
                    <SortableTH field="ownerName">Owner</SortableTH>
                    <SortableTH field="date">Date</SortableTH>
                    <SortableTH field="status">Status</SortableTH>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(start, end).map((e) => {
                    return (
                      <tr key={e.id} className="hover-highlight">
                        <td data-title="Watching status:" className="watching">
                          <WatchButton
                            item={e.id}
                            itemType="experiment"
                            type="icon"
                          />
                        </td>
                        <td
                          data-title="Contextual Bandit name:"
                          className="p-0"
                        >
                          <Link
                            href={`/contextual-bandit/${e.id}`}
                            style={{
                              display: "block",
                              padding: "0.5rem",
                            }}
                          >
                            <Flex direction="column">
                              <Flex>
                                <span className="testname">{e.name}</span>
                                {e.hasVisualChangesets ? (
                                  <Tooltip
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      marginLeft: "0.5rem",
                                    }}
                                    body="Visual experiment"
                                  >
                                    <RxDesktop className="text-blue" />
                                  </Tooltip>
                                ) : null}
                                {(e.linkedFeatures || []).length > 0 ? (
                                  <Tooltip
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      marginLeft: "0.5rem",
                                    }}
                                    body="Linked Feature Flag"
                                  >
                                    <BsFlag className="text-blue" />
                                  </Tooltip>
                                ) : null}
                                {e.hasURLRedirects ? (
                                  <Tooltip
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      marginLeft: "0.5rem",
                                    }}
                                    body="URL Redirect experiment"
                                  >
                                    <PiShuffle className="text-blue" />
                                  </Tooltip>
                                ) : null}
                              </Flex>
                              {isFiltered && e.trackingKey && (
                                <span
                                  className="testid text-muted small"
                                  title="Experiment Id"
                                >
                                  {e.trackingKey}
                                </span>
                              )}
                            </Flex>
                          </Link>
                        </td>
                        {showProjectColumn && (
                          <td className="nowrap" data-title="Project:">
                            {e.projectIsDeReferenced ? (
                              <Tooltip
                                body={
                                  <>
                                    Project <code>{e.project}</code> not found
                                  </>
                                }
                              >
                                <span className="text-danger">
                                  Invalid project
                                </span>
                              </Tooltip>
                            ) : (
                              (e.projectName ?? <em>None</em>)
                            )}
                          </td>
                        )}

                        <td data-title="Tags:" className="table-tags">
                          <SortedTags
                            tags={Object.values(e.tags)}
                            useFlex={true}
                            {...tagLinkProps("contextual-bandits")}
                            onTagClick={tagFilterOnClick(
                              searchInputProps.value,
                              setSearchValue,
                            )}
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
        </Box>
      </Box>
      {openNewModal && (
        <ContextualBanditForm
          onClose={() => setOpenNewModal(false)}
          source="contextual-bandits-list"
          isNewExperiment={true}
        />
      )}
    </>
  );
};

export default ContextualBanditsPage;
