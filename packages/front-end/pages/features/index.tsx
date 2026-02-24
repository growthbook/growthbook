import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ComputedFeatureInterface,
  FeatureInterface,
} from "shared/types/feature";
import { date, datetime } from "shared/dates";
import {
  featureHasEnvironment,
  filterEnvironmentsByFeature,
  isFeatureStale,
  StaleFeatureReason,
} from "shared/util";
import clsx from "clsx";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import LoadingOverlay from "@/components/LoadingOverlay";
import FeatureModal from "@/components/Features/FeatureModal";
import track from "@/services/track";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import RealTimeFeatureGraph from "@/components/Features/RealTimeFeatureGraph";
import {
  useFeaturesList,
  useRealtimeData,
  useEnvironments,
  useFeatureSearch,
} from "@/services/features";
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
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { TruncateMiddleWithTooltip } from "@/ui/TruncateMiddleWithTooltip";
import FeaturesDraftTable from "./FeaturesDraftTable";

const NUM_PER_PAGE = 20;
const HEADER_HEIGHT_PX = 55;

function valueTypeLabel(
  valueType: "boolean" | "string" | "number" | "json",
): string {
  const labels: Record<string, string> = {
    boolean: "Boolean",
    string: "String",
    number: "Number",
    json: "JSON",
  };
  return labels[valueType] ?? valueType;
}

export default function FeaturesPage() {
  const router = useRouter();
  const { organization } = useUser();
  const { data: sdkConnectionData } = useSDKConnections();
  const permissionsUtils = usePermissionsUtil();
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [featureToToggleStaleDetection, setFeatureToToggleStaleDetection] =
    useState<FeatureInterface | null>(null);

  const showGraphs = useFeature("feature-list-realtime-graphs").on;

  const permissionsUtil = usePermissionsUtil();
  const { project } = useDefinitions();
  const environments = useEnvironments();
  const {
    features: allFeatures,
    loading,
    error,
    mutate,
    hasArchived,
  } = useFeaturesList({
    useCurrentProject: true,
    includeArchived: showArchived,
  });
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

          <Table
            variant="list"
            stickyHeader
            stickyTopOffset={HEADER_HEIGHT_PX}
            roundedCorners
          >
            <TableHeader>
              <TableRow>
                <TableColumnHeader style={{ width: 40 }} />
                <SortableTableColumnHeader field="id">
                  Feature Key
                </SortableTableColumnHeader>
                {showProjectColumn && (
                  <TableColumnHeader>Project</TableColumnHeader>
                )}
                <SortableTableColumnHeader field="tags">
                  Tags
                </SortableTableColumnHeader>
                {toggleEnvs.map((en) => (
                  <TableColumnHeader
                    key={en.id}
                    style={{ textAlign: "center" }}
                  >
                    {en.id === "production" ? "Prod" : en.id}
                  </TableColumnHeader>
                ))}
                <TableColumnHeader>Data Type</TableColumnHeader>
                <TableColumnHeader>Changes</TableColumnHeader>
                <SortableTableColumnHeader field="dateUpdated">
                  Last Modified
                </SortableTableColumnHeader>
                {showGraphs && (
                  <TableColumnHeader>
                    Recent Usage{" "}
                    <Tooltip body="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'." />
                  </TableColumnHeader>
                )}
                <TableColumnHeader>Stale</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {featureItems.map((feature: ComputedFeatureInterface) => {
                const { stale, reason: staleReason } = staleFeatures?.[
                  feature.id
                ] || { stale: false };

                return (
                  <TableRow
                    key={feature.id}
                    className={clsx({
                      "text-muted": feature.archived,
                    })}
                  >
                    <TableCell className="watching">
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
                        <TruncateMiddleWithTooltip
                          text={feature.id}
                          maxChars={24}
                          maxWidth={180}
                        />
                      </Link>
                    </TableCell>
                    {showProjectColumn && (
                      <TableCell>
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
                            ) : null}
                          </>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
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
                    <TableCell style={{ minWidth: 80 }}>
                      {valueTypeLabel(feature.valueType)}
                    </TableCell>
                    <TableCell style={{ textAlign: "center" }}>
                      {feature?.hasDrafts ? (
                        <Tooltip body="Items requiring review">
                          <span
                            className="text-danger"
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor: "var(--red-9)",
                            }}
                            aria-hidden
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
                  </TableRow>
                );
              })}
              {!items.length && (
                <TableRow>
                  <TableCell
                    colSpan={
                      8 +
                      (showProjectColumn ? 1 : 0) +
                      toggleEnvs.length +
                      (showGraphs ? 1 : 0)
                    }
                  >
                    No matching features
                  </TableCell>
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

  const {
    searchInputProps,
    items,
    SortableTableColumnHeader,
    setSearchValue,
    syntaxFilters,
  } = useFeatureSearch({
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
          cta="Create"
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${
              hasFeatures ? "?new" : "?first&new"
            }`;
            router.push(url);
            mutate({
              features: [...allFeatures, feature],
              hasArchived,
            });
          }}
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
            <FeaturesDraftTable />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
