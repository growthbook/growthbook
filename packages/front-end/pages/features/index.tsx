import LoadingOverlay from "../../components/LoadingOverlay";
import { ago, datetime } from "../../services/dates";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { GBAddCircle } from "../../components/Icons";
import FeatureModal from "../../components/Features/FeatureModal";
import ValueDisplay from "../../components/Features/ValueDisplay";
import { useRouter } from "next/router";
import track from "../../services/track";
import FeaturesGetStarted from "../../components/HomePage/FeaturesGetStarted";
import useOrgSettings from "../../hooks/useOrgSettings";
import { useFeatureSearch, useSort } from "../../services/search";
import Field from "../../components/Forms/Field";
import EnvironmentToggle from "../../components/Features/EnvironmentToggle";
import RealTimeFeatureGraph from "../../components/Features/RealTimeFeatureGraph";
import { useFeature } from "@growthbook/growthbook-react";
import {
  getFeatureDefaultValue,
  getRules,
  useFeaturesList,
  useRealtimeData,
} from "../../services/features";
import Tooltip from "../../components/Tooltip";
import Pagination from "../../components/Pagination";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "../../components/Tags/TagsFilter";
import { useEnvironments } from "../../services/features";
import SortedTags from "../../components/Tags/SortedTags";
import { FaExclamationTriangle } from "react-icons/fa";
import Toggle from "../../components/Forms/Toggle";
import usePermissions from "../../hooks/usePermissions";
import WatchButton from "../../components/WatchButton";

const NUM_PER_PAGE = 20;

export default function FeaturesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const permissions = usePermissions();

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const { features, loading, error, mutate } = useFeaturesList();

  const showGraphs = useFeature("feature-list-realtime-graphs").on;
  const { usage, usageDomain } = useRealtimeData(
    features,
    !!router?.query?.mockdata,
    showGraphs
  );

  const settings = useOrgSettings();
  const [showSteps, setShowSteps] = useState(false);
  const tagsFilter = useTagsFilter("features");

  const stepsRequired =
    !settings?.sdkInstructionsViewed || (!loading && !features.length);

  const environments = useEnvironments();

  const { list, searchInputProps } = useFeatureSearch(features || [], [
    "id",
    "description",
    "tags",
  ]);

  const filtered = filterByTags(list, tagsFilter);

  let showArchivedToggle = false;
  for (const everyFeature of filtered) {
    if (everyFeature && everyFeature.archived) {
      showArchivedToggle = true;
      break;
    }
  }

  const { sorted, SortableTH } = useSort(filtered, "id", 1, "features");
  const [showArchived, setShowArchived] = useState(false);

  // Reset to page 1 when a filter is applied
  useEffect(() => {
    setCurrentPage(1);
  }, [sorted.length]);

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

  const toggleEnvs = environments.filter((en) => en.toggleOnList);

  return (
    <div className="contents container pagecontents">
      {modalOpen && (
        <FeatureModal
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
        />
      )}
      <div className="row mb-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {features.length > 0 && permissions.createFeatures && (
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
              <Field placeholder="Search..." {...searchInputProps} />
            </div>
            <div className="col-auto">
              <TagsFilter filter={tagsFilter} items={sorted} />
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

          <table className="table gbtable table-hover">
            <thead>
              <tr>
                <th></th>
                <SortableTH field="id">Feature Key</SortableTH>
                <th>Tags</th>
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
                    <Tooltip text="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'." />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted
                .filter((f) => !f.archived || showArchived)
                .slice(start, end)
                .map((feature) => {
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
                          <Tooltip text="This is a draft version and is not visible to users">
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
                    </tr>
                  );
                })}
              {!sorted.length && (
                <tr>
                  <td colSpan={showGraphs ? 7 : 6}>No matching features</td>
                </tr>
              )}
            </tbody>
          </table>
          {Math.ceil(sorted.length / NUM_PER_PAGE) > 1 && (
            <Pagination
              numItemsTotal={sorted.length}
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
