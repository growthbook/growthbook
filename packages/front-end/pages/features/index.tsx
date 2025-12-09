import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { Box, Flex } from "@radix-ui/themes";
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
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import LinkButton from "@/ui/LinkButton";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import EmptyState from "@/components/EmptyState";
import ProjectBadges from "@/components/ProjectBadges";
import FeatureSearchFilters from "@/components/Search/FeatureSearchFilters";
import { useExperiments } from "@/hooks/useExperiments";
import FeaturesDraftTable from "./FeaturesDraftTable";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

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
  const [featureToDuplicate, setFeatureToDuplicate] =
    useState<FeatureInterface | null>(null);
  const [featureToToggleStaleDetection, setFeatureToToggleStaleDetection] =
    useState<FeatureInterface | null>(null);

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
  const { experiments: allExperiments } = useExperiments();

  const { usage, usageDomain } = useRealtimeData(
    allFeatures,
    !!router?.query?.mockdata,
    showGraphs,
  );

  const staleFeatures = useMemo(() => {
    const staleFeatures: Record<
      string,
      { stale: boolean; reason?: StaleFeatureReason }
    > = {};
    allFeatures.forEach((feature) => {
      const featureEnvironments = filterEnvironmentsByFeature(
        environments,
        feature,
      );
      const envs = featureEnvironments.map((e) => e.id);
      staleFeatures[feature.id] = isFeatureStale({
        feature,
        features: allFeatures,
        experiments: allExperiments,
        environments: envs,
      });
    });
    return staleFeatures;
  }, [allFeatures, allExperiments, environments]);

  const renderFeaturesTable = () => {
    return (
      allFeatures.length > 0 && (
        <Box>
          <Box className="mb-2 align-items-center">
            <Flex justify="between" mb="3" gap="3" align="center">
              <Box className="relative" width="40%">
                <Field
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
              </Box>
              <FeatureSearchFilters
                features={allFeatures}
                searchInputProps={searchInputProps}
                setSearchValue={setSearchValue}
                syntaxFilters={syntaxFilters}
                hasArchived={hasArchived}
              />
            </Flex>
          </Box>

          <Table variant="standard" className="gb mb-3">
            <TableHeader
              className="sticky-top shadow-sm"
              style={{ top: HEADER_HEIGHT_PX + "px", zIndex: 900 }}
            >
              <tr>
                <th></TableColumnHeader>
                <SortableTH field="id">Feature Key</SortableTH>
                {showProjectColumn && <th>Project</TableColumnHeader>}
                <SortableTH field="tags">Tags</SortableTH>
                {toggleEnvs.map((en) => (
                  <TableColumnHeader key={en.id} className="text-center">
                    {en.id}
                  </TableColumnHeader>
                ))}
                <th>Prerequisites</TableColumnHeader>
                <th>Default</TableColumnHeader>
                <th>Rules</TableColumnHeader>
                <th>Version</TableColumnHeader>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
                {showGraphs && (
                  <th>
                    Recent Usage{" "}
                    <Tooltip body="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'." />
                  </TableColumnHeader>
                )}
                <th>Stale</TableColumnHeader>
                <TableColumnHeader style={{ width: 30 }}></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <tbody>
              {featureItems.map((feature: ComputedFeatureInterface) => {
                let rules: FeatureRule[] = [];
                environments.forEach(
                  (e) => (rules = rules.concat(getRules(feature, e.id))),
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
                  0,
                );
                const totalPrerequisites =
                  topLevelPrerequisites + prerequisiteRules;

                return (
                  <TableRow
                    key={feature.id}
                    className={clsx("hover-highlight", {
                      "text-muted": feature.archived,
                    })}
                  >
                    <TableCell data-title="Watching status:" className="watching">
                      <WatchButton
                        item={feature.id}
                        itemType="feature"
                        type="icon"
                      />
                    </TableCell>
                    <TableCell className="p-0">
                      <Link
                        href={`/features/${feature.id}`}
                        className={clsx("featurename d-block p-2", {
                          "text-muted": feature.archived,
                        })}
                      >
                        {feature.id}
                      </Link>
                    </TableCell>
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
                      </TableCell>
                    )}
                    <td>
                      <SortedTags tags={feature?.tags || []} useFlex={true} />
                    </TableCell>
                    {toggleEnvs.map((en) => (
                      <TableCell key={en.id}>
                        <Flex align="center" justify="center">
                          {featureHasEnvironment(feature, en) && (
                            <EnvironmentToggle
                              feature={feature}
                              environment={en.id}
                              mutate={mutate}
                            />
                          )}
                        </Flex>
                      </TableCell>
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
                    </TableCell>
                    <TableCell style={{ minWidth: 90 }}>
                      <ValueDisplay
                        value={getFeatureDefaultValue(feature) || ""}
                        type={feature.valueType}
                        full={false}
                        additionalStyle={{ maxWidth: 120, fontSize: "11px" }}
                      />
                    </TableCell>
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
                    </TableCell>
                    <TableCell style={{ textAlign: "center" }}>
                      {version}
                      {feature?.hasDrafts ? (
                        <Tooltip body="This feature has an active draft that has not been published yet">
                          <FaTriangleExclamation
                            className="text-warning ml-1"
                            style={{ marginTop: -3 }}
                          />
                        </Tooltip>
                      ) : null}
                    </TableCell>
                    <TableCell title={datetime(feature.dateUpdated)}>
                      {date(feature.dateUpdated)}
                    </TableCell>
                    {showGraphs && (
                      <TableCell style={{ width: 170 }}>
                        <RealTimeFeatureGraph
                          data={usage?.[feature.id]?.realtime || []}
                          yDomain={usageDomain}
                        />
                      </TableCell>
                    )}
                    <TableCell style={{ textAlign: "center" }}>
                      {stale && (
                        <StaleFeatureIcon
                          staleReason={staleReason}
                          onClick={() => {
                            if (
                              permissionsUtil.canViewFeatureModal(
                                feature.project,
                              )
                            )
                              setFeatureToToggleStaleDetection(feature);
                          }}
                        />
                      )}
                    </TableCell>
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
                    </TableCell>
                  </TableRow>
                );
              })}
              {!items.length && (
                <tr>
                  <TableCell colSpan={showGraphs ? 7 : 6}>No matching features</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
        </Box>
      )
    );
  };

  const { searchInputProps, items, SortableTH, setSearchValue, syntaxFilters } =
    useFeatureSearch({
      allFeatures,
      environments,
      staleFeatures,
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
  // watch to see if we should include archived features or not:
  useEffect(() => {
    const isArchivedFilter = syntaxFilters.some(
      (filter) =>
        filter.field === "is" &&
        !filter.negated &&
        filter.values.includes("archived"),
    );
    setShowArchived(isArchivedFilter);
  }, [syntaxFilters]);

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
      getDemoDatasourceProjectIdForOrganization(organization.id || ""),
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
            const url = `/features/${feature.id}${
              hasFeatures ? "?new" : "?first&new"
            }`;
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
