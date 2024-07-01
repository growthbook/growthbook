import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { date, datetime } from "shared/dates";
import {
  featureHasEnvironment,
  filterEnvironmentsByFeature,
  getMatchingRules,
  isFeatureStale,
  StaleFeatureReason,
} from "shared/util";
import { FaTriangleExclamation } from "react-icons/fa6";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle } from "@/components/Icons";
import FeatureModal from "@/components/Features/FeatureModal";
import ValueDisplay from "@/components/Features/ValueDisplay";
import track from "@/services/track";
import { useAddComputedFields, useSearch } from "@/services/search";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import RealTimeFeatureGraph from "@/components/Features/RealTimeFeatureGraph";
import {
  getFeatureDefaultValue,
  getRules,
  useFeaturesList,
  useRealtimeData,
  useEnvironments,
} from "@/services/features";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/components/Pagination";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import SortedTags from "@/components/Tags/SortedTags";
import Toggle from "@/components/Forms/Toggle";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import Tab from "@/components/Tabs/Tab";
import Tabs from "@/components/Tabs/Tabs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import FeaturesDraftTable from "./FeaturesDraftTable";

const NUM_PER_PAGE = 20;

export default function FeaturesPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [
    featureToDuplicate,
    setFeatureToDuplicate,
  ] = useState<FeatureInterface | null>(null);
  const [
    featureToToggleStaleDetection,
    setFeatureToToggleStaleDetection,
  ] = useState<FeatureInterface | null>(null);

  const showGraphs = useFeature("feature-list-realtime-graphs").on;

  const { getUserDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const { project, getProjectById } = useDefinitions();
  const environments = useEnvironments();
  const {
    features: allFeatures,
    experiments,
    loading,
    error,
    mutate,
    hasArchived,
  } = useFeaturesList(true, showArchived);

  const { usage, usageDomain } = useRealtimeData(
    allFeatures,
    !!router?.query?.mockdata,
    showGraphs
  );

  const staleFeatures = useMemo(() => {
    const staleFeatures: Record<
      string,
      { stale: boolean; reason?: StaleFeatureReason }
    > = {};
    allFeatures.forEach((feature) => {
      const featureEnvironments = filterEnvironmentsByFeature(
        environments,
        feature
      );
      const envs = featureEnvironments.map((e) => e.id);
      staleFeatures[feature.id] = isFeatureStale({
        feature,
        features: allFeatures,
        experiments,
        environments: envs,
      });
    });
    return staleFeatures;
  }, [allFeatures, experiments, environments]);

  const features = useAddComputedFields(
    allFeatures,
    (f) => {
      const projectId = f.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;

      const { stale, reason: staleReason } = staleFeatures?.[f.id] || {
        stale: false,
      };

      return {
        ...f,
        projectId,
        projectName,
        projectIsDeReferenced,
        stale,
        staleReason,
        ownerName: getUserDisplay(f.owner, false) || "",
      };
    },
    [staleFeatures, getProjectById]
  );

  // Searching
  const tagsFilter = useTagsFilter("features");
  const filterResults = useCallback(
    (items: typeof features) => {
      if (!showArchived) {
        items = items.filter((f) => !f.archived);
      }

      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [showArchived, tagsFilter.tags]
  );

  const renderFeaturesTable = () => {
    return (
      features.length > 0 && (
        <div>
          <div className="row mb-2 align-items-center">
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
            {showArchivedToggle && (
              <div className="col">
                <Toggle
                  value={showArchived}
                  id="archived"
                  setValue={setShowArchived}
                ></Toggle>
                Show Archived
              </div>
            )}
          </div>

          <table className="table gbtable table-hover appbox">
            <thead
              className="sticky-top bg-white shadow-sm"
              style={{ top: "56px", zIndex: 900 }}
            >
              <tr>
                <th></th>
                <SortableTH field="id">Feature Key</SortableTH>
                {showProjectColumn && <th>Project</th>}
                <SortableTH field="tags">Tags</SortableTH>
                {toggleEnvs.map((en) => (
                  <th key={en.id} className="text-center">
                    {en.id}
                  </th>
                ))}
                <th>Prerequisites</th>
                <th>
                  Default
                  <br />
                  Value
                </th>
                <th>
                  Overrides
                  <br />
                  Rules
                </th>
                <th>Version</th>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
                {showGraphs && (
                  <th>
                    Recent Usage{" "}
                    <Tooltip body="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'." />
                  </th>
                )}
                <th>Stale</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {featureItems.map((feature) => {
                let rules: FeatureRule[] = [];
                environments.forEach(
                  (e) => (rules = rules.concat(getRules(feature, e.id)))
                );

                // When showing a summary of rules, prefer experiments to rollouts to force rules
                const orderedRules = [
                  ...rules.filter((r) => r.type === "experiment"),
                  ...rules.filter((r) => r.type === "rollout"),
                  ...rules.filter((r) => r.type === "force"),
                ];

                const firstRule = orderedRules[0];
                const totalRules = rules.length || 0;

                const version = feature.version;

                const { stale, reason: staleReason } = staleFeatures?.[
                  feature.id
                ] || { stale: false };
                const topLevelPrerequisites =
                  feature.prerequisites?.length || 0;
                const prerequisiteRules = rules.reduce(
                  (acc, rule) => acc + (rule.prerequisites?.length || 0),
                  0
                );
                const totalPrerequisites =
                  topLevelPrerequisites + prerequisiteRules;

                return (
                  <tr
                    key={feature.id}
                    className={feature.archived ? "text-muted" : ""}
                  >
                    <td data-title="Watching status:" className="watching">
                      <WatchButton
                        item={feature.id}
                        itemType="feature"
                        type="icon"
                      />
                    </td>
                    <td>
                      <Link
                        href={`/features/${feature.id}`}
                        className={feature.archived ? "text-muted" : ""}
                      >
                        {feature.id}
                      </Link>
                    </td>
                    {showProjectColumn && (
                      <td>
                        {feature.projectIsDeReferenced ? (
                          <Tooltip
                            body={
                              <>
                                Project <code>{feature.project}</code> not found
                              </>
                            }
                          >
                            <span className="text-danger">Invalid project</span>
                          </Tooltip>
                        ) : (
                          feature.projectName ?? <em>None</em>
                        )}
                      </td>
                    )}
                    <td>
                      <SortedTags tags={feature?.tags || []} />
                    </td>
                    {toggleEnvs.map((en) => (
                      <td key={en.id} className="position-relative text-center">
                        {featureHasEnvironment(feature, en) && (
                          <EnvironmentToggle
                            feature={feature}
                            environment={en.id}
                            mutate={mutate}
                          />
                        )}
                      </td>
                    ))}
                    <td>
                      {totalPrerequisites > 0 && (
                        <div style={{ lineHeight: "16px" }}>
                          <div className="text-dark">
                            {totalPrerequisites} total
                          </div>
                          <div className="nowrap text-muted">
                            <small>
                              {topLevelPrerequisites > 0 && (
                                <>{topLevelPrerequisites} top level</>
                              )}
                              {prerequisiteRules > 0 && (
                                <>
                                  <>
                                    {topLevelPrerequisites > 0 && ", "}
                                    {prerequisiteRules} rules
                                  </>
                                </>
                              )}
                            </small>
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ minWidth: 90 }}>
                      <ValueDisplay
                        value={getFeatureDefaultValue(feature) || ""}
                        type={feature.valueType}
                        full={false}
                        additionalStyle={{ maxWidth: 120, fontSize: "11px" }}
                      />
                    </td>
                    <td>
                      <div style={{ lineHeight: "16px" }}>
                        {firstRule && (
                          <span className="text-dark">{firstRule.type}</span>
                        )}
                        {totalRules > 1 && (
                          <small className="text-muted ml-1">
                            +{totalRules - 1} more
                          </small>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {version}
                      {feature?.hasDrafts ? (
                        <Tooltip body="This feature has an active draft that has not been published yet">
                          <FaTriangleExclamation
                            className="text-warning ml-1"
                            style={{ marginTop: -3 }}
                          />
                        </Tooltip>
                      ) : null}
                    </td>
                    <td title={datetime(feature.dateUpdated)}>
                      {date(feature.dateUpdated)}
                    </td>
                    {showGraphs && (
                      <td style={{ width: 170 }}>
                        <RealTimeFeatureGraph
                          data={usage?.[feature.id]?.realtime || []}
                          yDomain={usageDomain}
                        />
                      </td>
                    )}
                    <td style={{ textAlign: "center" }}>
                      {stale && (
                        <StaleFeatureIcon
                          staleReason={staleReason}
                          onClick={() => {
                            if (
                              permissionsUtil.canViewFeatureModal(
                                feature.project
                              )
                            )
                              setFeatureToToggleStaleDetection(feature);
                          }}
                        />
                      )}
                    </td>
                    <td>
                      <MoreMenu>
                        {permissionsUtil.canCreateFeature(feature) &&
                        permissionsUtil.canManageFeatureDrafts({
                          project: feature.projectId,
                        }) ? (
                          <button
                            className="dropdown-item"
                            onClick={() => {
                              setFeatureToDuplicate(feature);
                              setModalOpen(true);
                            }}
                          >
                            Duplicate
                          </button>
                        ) : null}
                      </MoreMenu>
                    </td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr>
                  <td colSpan={showGraphs ? 7 : 6}>No matching features</td>
                </tr>
              )}
            </tbody>
          </table>
          {Math.ceil(items.length / NUM_PER_PAGE) > 1 && (
            <Pagination
              numItemsTotal={items.length}
              currentPage={currentPage}
              perPage={NUM_PER_PAGE}
              onPageChange={(d) => {
                setCurrentPage(d);
              }}
            />
          )}
        </div>
      )
    );
  };

  const { searchInputProps, items, SortableTH } = useSearch({
    items: features,
    defaultSortField: "id",
    searchFields: ["id^3", "description", "tags^2", "defaultValue"],
    filterResults,
    localStorageKey: "features",
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [item.valueType];
        if (item.archived) is.push("archived");
        if (item.hasDrafts) is.push("draft");
        if (item.stale) is.push("stale");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("project");
        if (item.hasDrafts) has.push("draft", "drafts");
        if (item.prerequisites?.length) has.push("prerequisites", "prereqs");

        if (item.valueType === "json" && item.jsonSchema?.enabled) {
          has.push("validation", "schema", "jsonSchema");
        }

        const rules = getMatchingRules(
          item,
          () => true,
          environments.map((e) => e.id)
        );

        if (rules.length) has.push("rule", "rules");
        if (
          rules.some((r) =>
            ["experiment", "experiment-ref"].includes(r.rule.type)
          )
        ) {
          has.push("experiment", "experiments");
        }
        if (rules.some((r) => r.rule.type === "rollout")) {
          has.push("rollout", "percent");
        }
        if (rules.some((r) => r.rule.type === "force")) {
          has.push("force", "targeting");
        }

        return has;
      },
      key: (item) => item.id,
      project: (item) => [item.project, item.projectName],
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      experiment: (item) => item.linkedExperiments || [],
      version: (item) => item.version,
      revision: (item) => item.version,
      owner: (item) => item.owner,
      tag: (item) => item.tags,
      rules: (item) => {
        const rules = getMatchingRules(
          item,
          () => true,
          environments.map((e) => e.id)
        );
        return rules.length;
      },
      on: (item) => {
        const on: string[] = [];
        environments.forEach((e) => {
          if (
            featureHasEnvironment(item, e) &&
            item.environmentSettings?.[e.id]?.enabled
          ) {
            on.push(e.id);
          }
        });
        return on;
      },
      off: (item) => {
        const off: string[] = [];
        environments.forEach((e) => {
          if (
            featureHasEnvironment(item, e) &&
            !item.environmentSettings?.[e.id]?.enabled
          ) {
            off.push(e.id);
          }
        });
        return off;
      },
    },
  });
  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const featureItems = items.slice(start, end);

  // Reset to page 1 when a filter is applied
  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  // Reset featureToDuplicate when modal is closed
  useEffect(() => {
    if (modalOpen) return;
    setFeatureToDuplicate(null);
  }, [modalOpen]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (loading) {
    return <LoadingOverlay />;
  }

  // If "All Projects" is selected is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && features.some((f) => f.project);

  // Ignore the demo datasource
  const hasFeatures = features.length > 0;

  const toggleEnvs = environments.filter((en) => en.toggleOnList);
  const showArchivedToggle = hasArchived;

  const canCreateFeatures = permissionsUtil.canManageFeatureDrafts({
    project,
  });

  return (
    <div className="contents container pagecontents">
      {modalOpen && (
        <FeatureModal
          cta={featureToDuplicate ? "Duplicate" : "Create"}
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${hasFeatures ? "" : "?first"}`;
            router.push(url);
            mutate({
              features: [...features, feature],
              linkedExperiments: experiments,
              hasArchived,
            });
          }}
          featureToDuplicate={featureToDuplicate || undefined}
        />
      )}
      {featureToToggleStaleDetection && (
        <StaleDetectionModal
          close={() => setFeatureToToggleStaleDetection(null)}
          feature={featureToToggleStaleDetection}
          mutate={mutate}
        />
      )}
      <div className="row mb-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {features.length > 0 &&
          permissionsUtil.canViewFeatureModal(project) &&
          canCreateFeatures && (
            <div className="col-auto">
              <button
                className="btn btn-primary float-right"
                onClick={() => {
                  setModalOpen(true);
                  track("Viewed Feature Modal", {
                    source: "feature-list",
                  });
                }}
                type="button"
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  <GBAddCircle />
                </span>
                Add Feature
              </button>
            </div>
          )}
      </div>
      <p>
        Features enable you to change your app&apos;s behavior from within the
        GrowthBook UI. For example, turn on/off a sales banner or change the
        title of your pricing page.{" "}
      </p>
      {!hasFeatures ? (
        <>
          <div
            className="appbox d-flex flex-column align-items-center"
            style={{ padding: "70px 305px 60px 305px" }}
          >
            <h1>Change your App&apos;s Behavior</h1>
            <p style={{ fontSize: "17px" }}>
              Use Feature Flags to change your app&apos;s behavior. For example,
              turn a sales banner on or off, or enable a new feature for Beta
              users only.
            </p>
            <div className="row">
              <Link href="/getstarted/feature-flag-guide">
                {" "}
                <button className="btn btn-outline-primary mr-2">
                  Setup Instructions
                </button>
              </Link>

              {permissionsUtil.canViewFeatureModal(project) &&
                canCreateFeatures && (
                  <button
                    className="btn btn-primary float-right"
                    onClick={() => {
                      setModalOpen(true);
                      track("Viewed Feature Modal", {
                        source: "feature-list",
                      });
                    }}
                    type="button"
                  >
                    <span className="h4 pr-2 m-0 d-inline-block align-top">
                      <GBAddCircle />
                    </span>
                    Add Feature
                  </button>
                )}
            </div>
          </div>
        </>
      ) : (
        <Tabs newStyle={true} defaultTab="all-features">
          <Tab id="all-features" display="All Features" padding={false}>
            {renderFeaturesTable()}
            <div className="alert alert-info mt-5">
              Looking for <strong>Attributes</strong>,{" "}
              <strong>Namespaces</strong>, <strong>Environments</strong>, or{" "}
              <strong>Saved Groups</strong>? They have moved to the{" "}
              <Link href="/sdks">SDK Configuration</Link> tab.
            </div>
          </Tab>
          <Tab id="drafts" display="Drafts" padding={false} lazy={true}>
            <FeaturesDraftTable features={features} />
          </Tab>
        </Tabs>
      )}
    </div>
  );
}
