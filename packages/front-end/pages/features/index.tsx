import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { Box, Switch, Text } from "@radix-ui/themes";
import {
  ComputedFeatureInterface,
  FeatureInterface,
  FeatureRule,
} from "back-end/types/feature";
import { date, datetime } from "shared/dates";
import {
  featureHasEnvironment,
  filterEnvironmentsByFeature,
  isFeatureStale,
  StaleFeatureReason,
} from "shared/util";
import { FaTriangleExclamation } from "react-icons/fa6";
import clsx from "clsx";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import LoadingOverlay from "@/components/LoadingOverlay";
import FeatureModal from "@/components/Features/FeatureModal";
import ValueDisplay from "@/components/Features/ValueDisplay";
import track from "@/services/track";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import RealTimeFeatureGraph from "@/components/Features/RealTimeFeatureGraph";
import {
  getFeatureDefaultValue,
  getRules,
  useFeaturesList,
  useRealtimeData,
  useEnvironments,
  useFeatureSearch,
} from "@/services/features";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/components/Pagination";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/Radix/Tabs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import LinkButton from "@/components/Radix/LinkButton";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import EmptyState from "@/components/EmptyState";
import ProjectBadges from "@/components/ProjectBadges";
import FeaturesDraftTable from "./FeaturesDraftTable";

const NUM_PER_PAGE = 20;
const HEADER_HEIGHT_PX = 55;

export default function FeaturesPage() {
  const router = useRouter();
  const { organization } = useUser();
  const { data: sdkConnectionData } = useSDKConnections();
  const permissionsUtils = usePermissionsUtil();
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

  const permissionsUtil = usePermissionsUtil();
  const { project } = useDefinitions();
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

  // Searching
  const tagsFilter = useTagsFilter("features");
  const filterResults = useCallback(
    (items: typeof allFeatures) => {
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
      allFeatures.length > 0 && (
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
              <Link
                href="https://docs.growthbook.io/using/growthbook-best-practices#syntax-search"
                target="_blank"
              >
                <Tooltip body={searchTermFilterExplainations}></Tooltip>
              </Link>
            </div>
            <div className="col-auto">
              <TagsFilter filter={tagsFilter} items={items} />
            </div>
            {showArchivedToggle && (
              <>
                <div className="flex-1" />
                <div className="col-auto">
                  <Text as="label" mb="0">
                    <Switch
                      checked={showArchived}
                      id="archived"
                      onCheckedChange={setShowArchived}
                      mr="2"
                    />
                    Show Archived
                  </Text>
                </div>
              </>
            )}
          </div>

          <table className="table gbtable appbox">
            <thead
              className="sticky-top shadow-sm"
              style={{ top: HEADER_HEIGHT_PX + "px", zIndex: 900 }}
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
                <th>Rules</th>
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
              {featureItems.map((feature: ComputedFeatureInterface) => {
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
                    className={clsx("hover-highlight", {
                      "text-muted": feature.archived,
                    })}
                  >
                    <td data-title="Watching status:" className="watching">
                      <WatchButton
                        item={feature.id}
                        itemType="feature"
                        type="icon"
                      />
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/features/${feature.id}`}
                        className={clsx("featurename d-block p-2", {
                          "text-muted": feature.archived,
                        })}
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
                          <>
                            {feature.project ? (
                              <ProjectBadges
                                resourceType="feature"
                                projectIds={[feature.projectId]}
                              />
                            ) : (
                              <></>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    <td>
                      <SortedTags tags={feature?.tags || []} useFlex={true} />
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

  const { searchInputProps, items, SortableTH } = useFeatureSearch({
    allFeatures,
    filterResults,
    environments,
  });

  const searchTermFilterExplainations = (
    <>
      <p>This search field supports advanced syntax search, including:</p>
      <ul>
        <li>
          <strong>key</strong>: The feature&apos;s key (name)
        </li>
        <li>
          <strong>owner</strong>: The creator of the feature (eg: owner:abby)
        </li>
        <li>
          <strong>rules</strong>: Matches based on the number of rules (eg:
          rules:&gt;2)
        </li>
        <li>
          <strong>tag</strong>: Features tagged with this tag
        </li>
        <li>
          <strong>project</strong>: The feature&apos;s project
        </li>
        <li>
          <strong>version</strong>: The feature&apos;s revision number
        </li>
        <li>
          <strong>experiment</strong>: The feature is linked to the specified
          experiment
        </li>
        <li>
          <strong>created</strong>:The feature&apos;s creation date, in UTC.
          Date entered is parsed so supports most formats.
        </li>
        <li>
          <strong>on</strong>: Shows features that are on for a specific
          environment (on:production)
        </li>
        <li>
          <strong>off</strong>: Shows features that are off for a specific
          environment (off:dev)
        </li>
      </ul>
      <p>Click to see all syntax fields supported in our docs.</p>
    </>
  );

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

  // If "All Projects" is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && allFeatures.some((f) => f.project);

  // Ignore the demo datasource
  const hasFeatures = allFeatures.some(
    (f) =>
      f.project !==
      getDemoDatasourceProjectIdForOrganization(organization.id || "")
  );

  const canUseSetupFlow =
    permissionsUtils.canCreateSDKConnection({
      projects: [project],
      environment: "production",
    }) &&
    permissionsUtils.canCreateEnvironment({
      projects: [project],
      id: "production",
    });

  const showSetUpFlow =
    !hasFeatures &&
    canUseSetupFlow &&
    sdkConnectionData &&
    !sdkConnectionData.connections.length;

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
              features: [...allFeatures, feature],
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
      <div className="row my-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {!showSetUpFlow &&
          permissionsUtil.canViewFeatureModal(project) &&
          canCreateFeatures && (
            <div className="col-auto">
              <Button
                onClick={() => {
                  setModalOpen(true);
                  track("Viewed Feature Modal", {
                    source: "feature-list",
                  });
                }}
              >
                Add Feature
              </Button>
            </div>
          )}
      </div>
      <div className="mt-3">
        <CustomMarkdown page={"featureList"} />
      </div>
      {!hasFeatures ? (
        <>
          <EmptyState
            title="Change your App's Behavior"
            description="Use Feature Flags to change your app's behavior. For example, turn a sales banner on or off, or enable new features for Beta users only."
            leftButton={
              <LinkButton
                external
                href="https://docs.growthbook.io/features/basics"
                variant="outline"
              >
                View Docs
              </LinkButton>
            }
            rightButton={
              showSetUpFlow ? (
                <LinkButton href="/setup?exitLocation=features">
                  Connect your SDK
                </LinkButton>
              ) : (
                permissionsUtil.canViewFeatureModal(project) &&
                canCreateFeatures && (
                  <Button
                    onClick={() => {
                      setModalOpen(true);
                      track("Viewed Feature Modal", {
                        source: "feature-list",
                      });
                    }}
                  >
                    Add Feature
                  </Button>
                )
              )
            }
          />
        </>
      ) : (
        <Tabs defaultValue="all-features" persistInURL={true}>
          <Box mb="3">
            <TabsList>
              <TabsTrigger value="all-features">All Features</TabsTrigger>
              <TabsTrigger value="drafts">Drafts</TabsTrigger>
            </TabsList>
          </Box>

          <TabsContent value="all-features">
            {renderFeaturesTable()}
            <Callout status="info" mt="5" mb="3">
              Test what values these features will return for your users from
              the <Link href="/archetypes#simulate">Simulate</Link> page.
            </Callout>
          </TabsContent>

          <TabsContent value="drafts">
            <FeaturesDraftTable features={allFeatures} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
