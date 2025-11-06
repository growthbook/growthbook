import React, { useEffect, useMemo, useState } from "react";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import clsx from "clsx";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useRouter } from "next/router";
import { startCase } from "lodash";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import TagsFilter, { useTagsFilter } from "@/components/Tags/TagsFilter";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import NewHoldoutForm from "@/components/Holdout/NewHoldoutForm";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useHoldouts } from "@/hooks/useHoldouts";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/ui/LinkButton";

const NUM_PER_PAGE = 20;

const HoldoutsPage = (): React.ReactElement => {
  const { ready, project, projects } = useDefinitions();

  const [tabs, setTabs] = useLocalStorage<string[]>("holdout_tabs", []);
  const { getUserDisplay } = useUser();
  const router = useRouter();
  const holdoutsEnabled = useFeatureIsOn("holdouts_feature");

  useEffect(() => {
    if (!holdoutsEnabled) {
      router.replace("/experiments");
    }
  }, [router, holdoutsEnabled]);

  const {
    holdouts,
    experiments: allExperiments,
    experimentsMap,
    hasArchived,
    error,
    loading,
    mutateHoldouts,
  } = useHoldouts(project, tabs.includes("archived"));

  const tagsFilter = useTagsFilter("experiments");

  const [openNewHoldoutModal, setOpenNewHoldoutModal] = useState(false);

  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [currentPage, setCurrentPage] = useState(1);

  const holdoutsWithExperiment = useMemo(() => {
    return holdouts
      .map((holdout) => ({
        ...holdout,
        experiment: experimentsMap.get(holdout.experimentId),
      }))
      .filter(
        (
          item,
        ): item is typeof item & {
          experiment: NonNullable<typeof item.experiment>;
        } => !!item.experiment,
      );
  }, [holdouts, experimentsMap]);

  const holdoutItems = useAddComputedFields(holdoutsWithExperiment, (item) => {
    // If draft, set duration to --
    // if running, set duration to start date to now
    // if stopped, set duration to start date to end date
    const durationString =
      item.experiment?.status === "draft"
        ? "--"
        : item.experiment?.status === "running"
          ? `${date(item.experiment.phases[0].dateStarted ?? "")} - now`
          : item.experiment?.status === "stopped"
            ? `${date(item.experiment.phases[0].dateStarted ?? "")} - ${date(
                item.experiment.phases[0].dateEnded ?? "",
              )}`
            : null;
    const projectsComputed = item.projects.reduce((acc, p) => {
      const project = projects.find((project) => project.id === p);
      if (!project) {
        return acc;
      }
      return [...acc, project.name];
    }, []);
    const statusString =
      startCase(item.experiment.status) +
      (item.experiment.status === "running" &&
      item.experiment.phases.length === 2
        ? ": Analysis Period"
        : "");

    const ownerName = getUserDisplay(item.experiment.owner, false) || "";
    return {
      name: item.name,
      projects: projectsComputed,
      tags: item.experiment.tags,
      duration: durationString,
      numExperiments: Object.values(item.linkedExperiments).length || "--",
      numFeatures: Object.values(item.linkedFeatures).length || "--",
      ownerName,
      hashAttribute: item.experiment.hashAttribute,
      status: item.experiment.status,
      holdoutStatus: statusString,
    };
  });

  const { items, searchInputProps, SortableTH } = useSearch({
    items: holdoutItems,
    searchFields: [
      "name",
      "projects",
      "ownerName",
      "hashAttribute",
      "holdoutStatus",
    ],
    localStorageKey: "holdout-search",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
  });

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.status] = counts[item.status] || 0;
      counts[item.status]++;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return tabs.length
      ? items.filter((item) => tabs.includes(item.status))
      : items;
  }, [tabs, items]);

  const hasHoldoutFeature = hasCommercialFeature("holdouts");

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

  const hasHoldoutsCreated = holdouts.length > 0 && allExperiments.length > 0;

  const canAdd = permissionsUtil.canViewExperimentModal(project);

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

  if (!hasHoldoutFeature) {
    return (
      <div className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Holdouts"
          title="Measure aggregate impact with Holdouts"
          description="Holdouts allow you to measure the aggregate impact of features and experiments."
          commercialFeature="holdouts"
          learnMoreLink="https://docs.growthbook.io/app/holdouts"
        />
      </div>
    );
  }

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-3 mt-2">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col d-flex align-items-center">
              <h1>Holdouts</h1>
            </div>
            <div style={{ flex: 1 }} />
            {canAdd && (
              <div className="col-auto">
                <PremiumTooltip tipPosition="left" commercialFeature="holdouts">
                  <Button
                    onClick={() => {
                      setOpenNewHoldoutModal(true);
                    }}
                    disabled={!hasHoldoutFeature}
                  >
                    Add Holdout
                  </Button>
                </PremiumTooltip>
              </div>
            )}
          </div>
          {!hasHoldoutsCreated ? (
            <EmptyState
              title="Measure aggregate impact with Holdouts"
              description="Measure the aggregate impact of features and experiments with
              Holdouts."
              leftButton={
                <LinkButton
                  href="https://docs.growthbook.io/app/holdouts"
                  variant="outline"
                  external={true}
                >
                  View docs
                </LinkButton>
              }
              rightButton={
                canAdd ? (
                  <PremiumTooltip
                    tipPosition="left"
                    popperStyle={{ top: 15 }}
                    commercialFeature="holdouts"
                  >
                    <Button
                      onClick={() => {
                        setOpenNewHoldoutModal(true);
                      }}
                      disabled={!hasHoldoutFeature}
                    >
                      Add Holdout
                    </Button>
                  </PremiumTooltip>
                ) : null
              }
            />
          ) : (
            <>
              <div className="row align-items-center mb-3">
                <div className="col-auto d-flex">
                  {["running", "draft", "stopped", "archived"].map((tab, i) => {
                    const active = tabs.includes(tab);

                    if (tab === "archived" && !hasArchived) return null;

                    return (
                      <button
                        key={tab}
                        className={clsx("border mb-0", {
                          "badge-purple font-weight-bold": active,
                          "text-secondary": !active,
                          "rounded-left": i === 0,
                          "rounded-right":
                            tab === "archived" ||
                            (tab === "stopped" && !hasArchived),
                        })}
                        style={{
                          fontSize: "1em",
                          opacity: active ? 1 : 0.8,
                          padding: "6px 12px",
                          backgroundColor: active ? "" : "var(--color-panel)",
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          onToggleTab(tab)();
                        }}
                        title={
                          active && tabs.length > 1
                            ? `Hide ${tab} holdouts`
                            : active
                              ? `Remove filter`
                              : tabs.length === 0
                                ? `View only ${tab} holdouts`
                                : `Include ${tab} holdouts`
                        }
                      >
                        <span className="mr-1">
                          {tab.slice(0, 1).toUpperCase()}
                          {tab.slice(1)}
                        </span>
                        {tab !== "archived" && (
                          <span className="badge bg-white border text-dark mr-2">
                            {tabCounts[tab] || 0}
                          </span>
                        )}
                      </button>
                    );
                  })}
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
              </div>

              <table className="appbox table experiment-table gbtable responsive-table">
                <thead>
                  <tr>
                    <SortableTH field="name">Holdout Name</SortableTH>
                    <SortableTH field="projects">Projects</SortableTH>
                    <th>Tags</th>
                    <SortableTH field="ownerName">Owner</SortableTH>
                    <SortableTH field="hashAttribute">ID Type</SortableTH>
                    <th>Experiments</th>
                    <th>Features</th>
                    <SortableTH field="holdoutStatus">Status</SortableTH>
                    <SortableTH field="duration">Duration</SortableTH>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(start, end).map((holdout) => {
                    return (
                      <tr key={holdout.id} className="hover-highlight">
                        <td data-title="Holdout name:" className="p-0">
                          <Link
                            href={`/holdout/${holdout.id}`}
                            className="d-block p-2"
                          >
                            <div className="d-flex flex-column">
                              <div className="d-flex">
                                <span className="testname">{holdout.name}</span>
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td data-title="Projects:">
                          {holdout.projects.length === 0
                            ? null
                            : holdout.projects.join(", ")}
                        </td>
                        <td data-title="Tags:">
                          <SortedTags
                            tags={Object.values(holdout?.tags || [])}
                            useFlex={true}
                          />
                        </td>
                        <td className="nowrap" data-title="Owner:">
                          <span className="text-truncate">
                            {holdout.ownerName}
                          </span>
                        </td>
                        <td className="nowrap" data-title="ID Type:">
                          {holdout.hashAttribute}
                        </td>
                        <td className="nowrap">{holdout.numExperiments}</td>
                        <td className="nowrap">{holdout.numFeatures}</td>
                        <td className="nowrap" data-title="Status:">
                          {holdout.holdoutStatus}
                        </td>
                        <td
                          className="nowrap"
                          title={datetime(
                            holdout.experiment.phases[0].dateStarted ?? "",
                          )}
                        >
                          {holdout.duration}
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
        </div>
      </div>
      {openNewHoldoutModal && (
        <NewHoldoutForm
          onClose={() => setOpenNewHoldoutModal(false)}
          source="holdouts-list"
          isNewHoldout
          mutate={mutateHoldouts}
        />
      )}
    </>
  );
};

export default HoldoutsPage;
