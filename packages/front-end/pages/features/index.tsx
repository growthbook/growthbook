import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { FaExclamationTriangle } from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import LoadingOverlay from "@/components/LoadingOverlay";
import { ago, datetime } from "@/services/dates";
import { GBAddCircle } from "@/components/Icons";
import FeatureModal from "@/components/Features/FeatureModal";
import ValueDisplay from "@/components/Features/ValueDisplay";
import track from "@/services/track";
import FeaturesGetStarted from "@/components/HomePage/FeaturesGetStarted";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  filterFeaturesByEnvironment,
  removeEnvFromSearchTerm,
  useSearch,
} from "@/services/search";
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
import usePermissions from "@/hooks/usePermissions";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";

const NUM_PER_PAGE = 20;

export default function FeaturesPage() {
  const router = useRouter();

  const [modalOpen, setModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [
    featureToDuplicate,
    setFeatureToDuplicate,
  ] = useState<FeatureInterface | null>(null);

  const showGraphs = useFeature("feature-list-realtime-graphs").on;

  const permissions = usePermissions();
  const { project, getProjectById } = useDefinitions();
  const settings = useOrgSettings();
  const environments = useEnvironments();
  const { features, loading, error, mutate } = useFeaturesList();

  const { usage, usageDomain } = useRealtimeData(
    features,
    !!router?.query?.mockdata,
    showGraphs
  );

  // Searching
  const tagsFilter = useTagsFilter("features");
  const filterResults = useCallback(
    (items: FeatureInterface[], originalQuery: string) => {
      if (!showArchived) {
        items = items.filter((f) => !f.archived);
      }
      items = filterFeaturesByEnvironment(
        items,
        originalQuery,
        environments.map((e) => e.id)
      );
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [showArchived, tagsFilter.tags, environments]
  );
  const { searchInputProps, items, SortableTH } = useSearch({
    items: features,
    defaultSortField: "id",
    searchFields: ["id^3", "description", "tags^2", "defaultValue"],
    transformQuery: removeEnvFromSearchTerm,
    filterResults,
    localStorageKey: "features",
  });

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

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  // If "All Projects" is selected is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && features.some((f) => f.project);

  const toggleEnvs = environments.filter((en) => en.toggleOnList);
  const showArchivedToggle = features.some((f) => f.archived);
  const stepsRequired =
    !settings?.sdkInstructionsViewed || (!loading && !features.length);

  return (
    <div className="contents container pagecontents">
      {modalOpen && (
        <FeatureModal
          cta={featureToDuplicate ? "Duplicate" : "Create"}
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${
              features.length > 0 ? "" : "?first"
            }`;
            router.push(url);
            mutate({
              features: [...features, feature],
            });
          }}
          featureToDuplicate={featureToDuplicate}
        />
      )}
      <div className="row mb-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {features.length > 0 &&
          permissions.check("manageFeatures", project) &&
          permissions.check("createFeatureDrafts", project) && (
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
      {stepsRequired || showSteps ? (
        <div className="mb-3">
          <h4>
            Setup Steps
            {!stepsRequired && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowSteps(false);
                }}
                style={{ fontSize: "0.8em" }}
                className="ml-3"
              >
                hide
              </a>
            )}
          </h4>
          <FeaturesGetStarted features={features} />
          {!stepsRequired && <h4 className="mt-3">All Features</h4>}
        </div>
      ) : (
        <div className="mb-3">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowSteps(true);
            }}
          >
            Show Setup Steps
          </a>
        </div>
      )}

      {features.length > 0 && (
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
            <thead>
              <tr>
                <th></th>
                <SortableTH field="id">Feature Key</SortableTH>
                {showProjectColumn && <th>Project</th>}
                <SortableTH field="tags">Tags</SortableTH>
                {toggleEnvs.map((en) => (
                  <th key={en.id}>{en.id}</th>
                ))}
                <th>Value When Enabled</th>
                <th>Overrides Rules</th>
                <th>Version</th>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
                {showGraphs && (
                  <th>
                    Recent Usage{" "}
                    <Tooltip body="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'." />
                  </th>
                )}
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.slice(start, end).map((feature) => {
                let rules = [];
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

                const isDraft = !!feature.draft?.active;
                let version = feature.revision?.version || 1;
                if (isDraft) version++;

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
                      <Link href={`/features/${feature.id}`}>
                        <a className={feature.archived ? "text-muted" : null}>
                          {feature.id}
                        </a>
                      </Link>
                    </td>
                    {showProjectColumn && (
                      <td>{getProjectById(feature.project)?.name || ""}</td>
                    )}
                    <td>
                      <SortedTags tags={feature?.tags || []} />
                    </td>
                    {toggleEnvs.map((en) => (
                      <td key={en.id} className="position-relative">
                        <EnvironmentToggle
                          feature={feature}
                          environment={en.id}
                          mutate={mutate}
                        />
                      </td>
                    ))}
                    <td>
                      <ValueDisplay
                        value={getFeatureDefaultValue(feature)}
                        type={feature.valueType}
                        full={false}
                      />
                    </td>
                    <td>
                      {firstRule && (
                        <span className="text-dark">{firstRule.type}</span>
                      )}
                      {totalRules > 1 && (
                        <small className="text-muted ml-1">
                          +{totalRules - 1} more
                        </small>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {version}{" "}
                      {isDraft && (
                        <Tooltip body="This is a draft version and is not visible to users">
                          <FaExclamationTriangle className="text-warning" />
                        </Tooltip>
                      )}
                    </td>
                    <td title={datetime(feature.dateUpdated)}>
                      {ago(feature.dateUpdated)}
                    </td>
                    {showGraphs && (
                      <td style={{ width: 170 }}>
                        <RealTimeFeatureGraph
                          data={usage?.[feature.id]?.realtime || []}
                          yDomain={usageDomain}
                        />
                      </td>
                    )}
                    <td>
                      <MoreMenu>
                        <button
                          className="dropdown-item"
                          onClick={() => {
                            setFeatureToDuplicate(feature);
                            setModalOpen(true);
                          }}
                        >
                          Duplicate
                        </button>
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
      )}
    </div>
  );
}
