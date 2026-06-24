import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { Box, Flex } from "@radix-ui/themes";
import { FaRegCircleCheck, FaRegCircleXmark } from "react-icons/fa6";
import { FeatureInterface, FeatureMetaInfo } from "shared/types/feature";
import { date, datetime } from "shared/dates";
import { featureHasEnvironment } from "shared/util";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import Link from "@/ui/Link";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import FeatureModal from "@/components/Features/FeatureModal";
import { featureStatusColors } from "@/components/Features/FeaturesOverview";
import track from "@/services/track";
import RealTimeFeatureGraph from "@/components/Features/RealTimeFeatureGraph";
import {
  useRealtimeData,
  useEnvironments,
  useFeatureSearch,
} from "@/services/features";
import { tagFilterOnClick, tagLinkProps } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/ui/Pagination";
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import FeatureStatusBadge from "@/components/Features/FeatureStatusBadge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import LinkButton from "@/ui/LinkButton";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import EmptyState from "@/components/EmptyState";
import FeatureSearchFilters from "@/components/Search/FeatureSearchFilters";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useFeaturesStatus } from "@/hooks/useFeaturesStatus";
import { useFeatureDraftStates } from "@/hooks/useFeatureDraftStates";
import { useFeatureStaleStates } from "@/hooks/useFeatureStaleStates";
import {
  draftStatusDots,
  draftStatusTooltip,
} from "@/components/Reviews/RevisionStatusBadge";
import Badge from "@/ui/Badge";
import { useFeatureContentSearch } from "@/hooks/useFeatureContentSearch";
import type { ContentSearchParams } from "@/hooks/useFeatureContentSearch";
import { useFeatureRampStates } from "@/hooks/useFeatureRampStates";
import { useFeatureDependencyIndex } from "@/hooks/useFeatureDependencyIndex";
import { useFeatureExperimentStates } from "@/hooks/useFeatureExperimentStates";
import ProjectBadges from "@/components/ProjectBadges";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import FeaturesDraftTable from "./FeaturesDraftTable";

const NUM_PER_PAGE = 20;

const CONTENT_SEARCH_PREFIXES: {
  prefix: string;
  paramKey: keyof ContentSearchParams;
}[] = [
  { prefix: "value:", paramKey: "valueContains" },
  { prefix: "attribute:", paramKey: "attribute" },
  { prefix: "saved-group:", paramKey: "savedGroup" },
  { prefix: "experiment:", paramKey: "experiment" },
  { prefix: "bandit:", paramKey: "bandit" },
];
const CONTENT_SEARCH_PREFIX_STRINGS = CONTENT_SEARCH_PREFIXES.map(
  (p) => p.prefix,
);

function extractContentSearchParams(searchStr: string): ContentSearchParams {
  const params: ContentSearchParams = {};
  for (const token of searchStr.split(/\s+/)) {
    if (!token.startsWith("has:")) continue;
    const val = token.slice(4);
    for (const { prefix, paramKey } of CONTENT_SEARCH_PREFIXES) {
      if (val.startsWith(prefix)) {
        params[paramKey] = decodeURIComponent(val.slice(prefix.length));
      }
    }
  }
  return params;
}

// Feature table column widths (shared by header and body for alignment)
const FEATURE_TABLE_COLUMN_WIDTH = {
  WATCHING: 40,
  TAGS: 160,
  DATA_TYPE_MIN: 80,
  RECENT_USAGE: 170,
} as const;

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
  const permissionsUtil = usePermissionsUtil();
  const [modalOpen, setModalOpen] = useState(false);
  const [featureToDuplicate, setFeatureToDuplicate] =
    useState<FeatureInterface | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const showGraphs = useFeature("feature-list-realtime-graphs").on;

  const { project, projects } = useDefinitions();
  const environments = useEnvironments();

  const {
    features: allFeatures,
    loading,
    error,
    mutate,
    hasArchived,
  } = useFeatureMetaInfo({
    project: project || undefined,
  });

  // Track whether archived features should be shown (controlled by is:archived filter).
  // useFeatureMetaInfo always returns all features; this controls client-side display.
  const [showArchived, setShowArchived] = useState(false);

  const { usage, usageDomain } = useRealtimeData(
    allFeatures as unknown as FeatureInterface[],
    !!router?.query?.mockdata,
  );

  const statusHook = useFeaturesStatus();
  const draftHook = useFeatureDraftStates();
  const staleHook = useFeatureStaleStates();
  const rampHook = useFeatureRampStates();
  const dependencyHook = useFeatureDependencyIndex();
  const experimentHook = useFeatureExperimentStates();

  const archivedFilter = useMemo(
    () =>
      showArchived
        ? undefined
        : (items: FeatureMetaInfo[]) => items.filter((f) => !f.archived),
    [showArchived],
  );

  const {
    searchInputProps,
    items: searchItems,
    SortableTableColumnHeader,
    setSearchValue,
    syntaxFilters,
  } = useFeatureSearch({
    allFeatures,
    environments,
    environmentStatus: statusHook.environmentStatus,
    draftStates: draftHook.draftStates,
    staleStates: staleHook.staleStates,
    rampStates: rampHook.rampStates,
    dependencyIndex: dependencyHook.dependencyIndex,
    experimentStates: experimentHook.experimentStates,
    filterResults: archivedFilter,
    contentSearchPrefixes: CONTENT_SEARCH_PREFIX_STRINGS,
  });

  const contentSearchParams = useMemo(
    () => extractContentSearchParams(searchInputProps.value),
    [searchInputProps.value],
  );
  const contentSearch = useFeatureContentSearch(contentSearchParams);

  const items = useMemo(() => {
    if (!contentSearch.matchingIds) return searchItems;
    const ids = contentSearch.matchingIds;
    return searchItems.filter((f) => ids.has(f.id));
  }, [searchItems, contentSearch.matchingIds]);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const featureItems = useMemo(
    () => items.slice(start, end),
    [items, start, end],
  );

  // Reset to page 1 when a filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  // Sync showArchived from the is:archived syntax filter
  useEffect(() => {
    const isArchivedFilter = syntaxFilters.some(
      (filter) =>
        filter.field === "is" &&
        !filter.negated &&
        filter.values.includes("archived"),
    );
    setShowArchived(isArchivedFilter);
  }, [syntaxFilters]);

  // Stable string key so effects only fire when the visible ID set actually changes,
  // not just when the slice produces a new array reference.
  const visibleIdsKey = useMemo(
    () => featureItems.map((f) => f.id).join(","),
    [featureItems],
  );

  // fetchAll is triggered only by filter changes, not by visibleIdsKey changes.
  // Keeping them separate prevents an infinite loop where fetchAll updates the data,
  // which changes items, which changes visibleIdsKey, which re-triggers fetchAll.
  const hasEnvFilter = syntaxFilters.some(
    (f) => f.field === "on" || f.field === "off",
  );
  const hasDraftFilter = syntaxFilters.some(
    (f) =>
      (f.field === "is" && f.values.includes("draft")) ||
      (f.field === "has" && f.values.includes("draft")),
  );
  const hasStaleFilter = syntaxFilters.some(
    (f) =>
      (f.field === "is" && f.values.includes("stale")) ||
      (f.field === "has" && f.values.includes("stale-env")),
  );
  const hasRampFilter = syntaxFilters.some(
    (f) => f.field === "has" && f.values.includes("ramp-schedule"),
  );
  const hasDependentsFilter = syntaxFilters.some(
    (f) => f.field === "has" && f.values.includes("dependents"),
  );
  const hasExperimentStateFilter = syntaxFilters.some(
    (f) =>
      f.field === "has" &&
      f.values.some(
        (v) =>
          v === "experiments" ||
          v === "temp-rollout" ||
          v.startsWith("experiment:") ||
          v.startsWith("bandit:"),
      ),
  );

  useEffect(() => {
    if (hasEnvFilter) statusHook.fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEnvFilter]);

  useEffect(() => {
    if (hasDraftFilter) draftHook.fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraftFilter]);

  useEffect(() => {
    if (hasStaleFilter) staleHook.fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStaleFilter]);

  useEffect(() => {
    if (hasRampFilter) rampHook.fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRampFilter]);

  useEffect(() => {
    if (hasDependentsFilter) dependencyHook.fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDependentsFilter]);

  useEffect(() => {
    if (hasExperimentStateFilter) experimentHook.fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasExperimentStateFilter]);

  // fetchSome for visible features when no bulk filter is active
  useEffect(() => {
    const ids = visibleIdsKey ? visibleIdsKey.split(",") : [];
    if (!ids.length) return;
    if (!hasEnvFilter) statusHook.fetchSome(ids);
    if (!hasDraftFilter) draftHook.fetchSome(ids);
    if (!hasStaleFilter) staleHook.fetchSome(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIdsKey]);

  const searchLoading = !!(
    statusHook.loading ||
    draftHook.loading ||
    staleHook.loading ||
    rampHook.loading ||
    dependencyHook.loading ||
    experimentHook.loading ||
    contentSearch.loading
  );

  const renderFeaturesTable = () => {
    return (
      allFeatures.length > 0 && (
        <Box>
          <Box mb="2">
            <Flex justify="between" mb="3" gap="3" align="center">
              <Flex align="center" gap="1" width="40%">
                <Box flexGrow="1" style={{ position: "relative" }}>
                  <Field
                    placeholder="Search..."
                    type="search"
                    containerClassName="mb-0"
                    {...searchInputProps}
                  />
                </Box>
                <Box style={{ width: 20, flexShrink: 0 }}>
                  {searchLoading ? <LoadingSpinner /> : null}
                </Box>
              </Flex>
              <FeatureSearchFilters
                features={allFeatures}
                searchInputProps={searchInputProps}
                setSearchValue={setSearchValue}
                syntaxFilters={syntaxFilters}
                hasArchived={hasArchived}
              />
            </Flex>
          </Box>

          <Table variant="list" stickyHeader roundedCorners>
            <TableHeader>
              <TableRow>
                <TableColumnHeader
                  style={{ width: FEATURE_TABLE_COLUMN_WIDTH.WATCHING }}
                />
                <SortableTableColumnHeader field="id" style={{ width: "20%" }}>
                  Feature Key
                </SortableTableColumnHeader>
                {showProjectColumn && (
                  <TableColumnHeader>Project</TableColumnHeader>
                )}
                <TableColumnHeader
                  style={{ maxWidth: FEATURE_TABLE_COLUMN_WIDTH.TAGS }}
                >
                  Tags
                </TableColumnHeader>
                <TableColumnHeader>Rules</TableColumnHeader>
                {toggleEnvs.map((en) => (
                  <TableColumnHeader
                    key={en.id}
                    style={{ textAlign: "center" }}
                  >
                    {en.id}
                  </TableColumnHeader>
                ))}
                <TableColumnHeader>Data Type</TableColumnHeader>
                <TableColumnHeader style={{ textAlign: "center" }}>
                  Draft Status
                </TableColumnHeader>
                <SortableTableColumnHeader field="dateUpdated">
                  Last Modified
                </SortableTableColumnHeader>
                {showGraphs && (
                  <TableColumnHeader>
                    Recent Usage{" "}
                    <Tooltip
                      flipTheme={false}
                      body="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'."
                    />
                  </TableColumnHeader>
                )}
                <TableColumnHeader>Status</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {featureItems.map((feature) => {
                const draftEntry = draftHook.draftStates[feature.id];

                return (
                  <TableRow
                    key={feature.id}
                    style={{
                      color: feature.archived ? "var(--gray-11)" : undefined,
                    }}
                  >
                    <TableCell className="watching">
                      <WatchButton
                        item={feature.id}
                        itemType="feature"
                        type="icon"
                      />
                    </TableCell>
                    <TableCell
                      style={{
                        padding: "var(--space-0)",
                      }}
                    >
                      <Link
                        href={`/features/${feature.id}`}
                        className="featurename"
                        style={{
                          padding: "var(--space-3)",
                          display: "block",
                          color: feature.archived
                            ? "var(--gray-11)"
                            : undefined,
                        }}
                      >
                        {feature.id}
                      </Link>
                    </TableCell>
                    {showProjectColumn && (
                      <TableCell>
                        {feature.project ? (
                          <ProjectBadges
                            resourceType="feature"
                            projectIds={[feature.project]}
                          />
                        ) : null}
                      </TableCell>
                    )}
                    <TableCell
                      style={{
                        width: FEATURE_TABLE_COLUMN_WIDTH.TAGS,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        className="tags-cell-content"
                        style={{
                          minWidth: 0,
                          maxWidth: "100%",
                          overflow: "hidden",
                        }}
                      >
                        <SortedTags
                          tags={feature?.tags || []}
                          useFlex={true}
                          maxVisibleTags={1}
                          truncateTagChars={15}
                          {...tagLinkProps("features")}
                          onTagClick={tagFilterOnClick(
                            searchInputProps.value,
                            setSearchValue,
                          )}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      {feature.ruleTypes && feature.ruleTypes.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            gap: "4px",
                            flexWrap: "wrap",
                          }}
                        >
                          {feature.ruleTypes.map((type) => {
                            let label =
                              type.charAt(0).toUpperCase() + type.slice(1);
                            if (type === "experiment-ref")
                              label = "Experiment Ref";
                            else if (type === "safe-rollout")
                              label = "Safe Rollout";
                            return (
                              <Badge key={type} color="gray">
                                {label}
                              </Badge>
                            );
                          })}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {toggleEnvs.map((en) => (
                      <TableCell key={en.id}>
                        <Flex align="center" justify="center">
                          {featureHasEnvironment(
                            feature as unknown as FeatureInterface,
                            en,
                          ) &&
                            (() => {
                              const enabled =
                                statusHook.environmentStatus[feature.id]?.[
                                  en.id
                                ] ?? false;
                              return (
                                <Tooltip
                                  flipTheme={false}
                                  body={
                                    enabled
                                      ? `${en.id}: enabled`
                                      : `${en.id}: disabled`
                                  }
                                >
                                  {enabled ? (
                                    <FaRegCircleCheck
                                      style={{
                                        color: featureStatusColors.on,
                                        fontSize: 18,
                                      }}
                                      aria-hidden
                                    />
                                  ) : (
                                    <FaRegCircleXmark
                                      style={{
                                        color: featureStatusColors.offMuted,
                                        fontSize: 18,
                                      }}
                                      aria-hidden
                                    />
                                  )}
                                </Tooltip>
                              );
                            })()}
                        </Flex>
                      </TableCell>
                    ))}
                    <TableCell
                      style={{
                        minWidth: FEATURE_TABLE_COLUMN_WIDTH.DATA_TYPE_MIN,
                      }}
                    >
                      {valueTypeLabel(feature.valueType)}
                    </TableCell>
                    <TableCell>
                      {draftEntry
                        ? (() => {
                            const dots = draftStatusDots(draftEntry);
                            if (!dots.length) return null;
                            return (
                              <Tooltip
                                flipTheme={false}
                                body={draftStatusTooltip(draftEntry)}
                              >
                                <Flex
                                  align="center"
                                  justify="center"
                                  gap="1"
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    padding: "0 4px",
                                  }}
                                >
                                  {dots.map((bg) => (
                                    <span
                                      key={bg}
                                      style={{
                                        display: "block",
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        flexShrink: 0,
                                        background: bg,
                                      }}
                                    />
                                  ))}
                                </Flex>
                              </Tooltip>
                            );
                          })()
                        : null}
                    </TableCell>
                    <TableCell title={datetime(feature.dateUpdated)}>
                      {date(feature.dateUpdated)}
                    </TableCell>
                    {showGraphs && (
                      <TableCell
                        style={{
                          width: FEATURE_TABLE_COLUMN_WIDTH.RECENT_USAGE,
                        }}
                      >
                        {!feature.archived && (
                          <RealTimeFeatureGraph
                            data={usage?.[feature.id]?.realtime || []}
                            yDomain={usageDomain}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell style={{ textAlign: "left" }}>
                      <FeatureStatusBadge
                        feature={feature}
                        envStatus={statusHook.environmentStatus[feature.id]}
                        context="list"
                        staleData={staleHook.getStaleState(feature.id)}
                        fetchStaleData={async () => {
                          staleHook.invalidate([feature.id]);
                          await staleHook.fetchSome([feature.id]);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!items.length && (
                <TableRow>
                  <TableCell
                    colSpan={
                      7 +
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

  const canViewFeatureModal = permissionsUtil.canViewFeatureModal(
    project,
    projects,
  );

  const canCreateFeatures = useMemo(() => {
    // If a specific project is selected, check permissions for that project
    if (project) {
      return permissionsUtil.canManageFeatureDrafts({ project });
    }
    // "All Projects" selected. Check the global (no-project) permission first so
    // a user who can create features at the org level (e.g. an admin) isn't
    // blocked by a non-creatable project. Otherwise the read-only sample-data
    // project would disable the button whenever it's the only project.
    if (
      permissionsUtil.canCreateFeature({ project: "" }) &&
      permissionsUtil.canManageFeatureDrafts({ project: "" })
    ) {
      return true;
    }
    // Otherwise, allow if they can create in at least one specific project.
    return (projects ?? []).some(
      (p) =>
        permissionsUtil.canCreateFeature({ project: p.id }) &&
        permissionsUtil.canManageFeatureDrafts({ project: p.id }),
    );
  }, [project, projects, permissionsUtil]);

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }
  if (loading) {
    return <LoadingOverlay />;
  }

  // If "All Projects" is selected and some features are in a project, show the project column
  const showProjectColumn = !project && allFeatures.some((f) => f.project);

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || "",
  );
  const isDemoProject = !!project && project === demoProjectId;

  // When viewing the demo project explicitly, show its features. Otherwise
  // ignore demo-project features when deciding whether to show the empty state.
  const hasFeatures = isDemoProject
    ? allFeatures.length > 0
    : allFeatures.some((f) => f.project !== demoProjectId);

  const canUseSetupFlow =
    permissionsUtil.canCreateSDKConnection({
      projects: [project],
      environment: "production",
    }) &&
    permissionsUtil.canCreateEnvironment({
      projects: [project],
      id: "production",
    });

  const showSetUpFlow =
    !hasFeatures &&
    canUseSetupFlow &&
    sdkConnectionData &&
    !sdkConnectionData.connections.length;

  const toggleEnvs = environments.filter((en) => en.toggleOnList);

  return (
    <Box className="contents pagecontents" style={{ margin: "0 auto" }}>
      {modalOpen && (
        <FeatureModal
          cta={featureToDuplicate ? "Duplicate" : "Create"}
          close={() => {
            setModalOpen(false);
            setFeatureToDuplicate(null);
          }}
          featureToDuplicate={featureToDuplicate || undefined}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${
              hasFeatures ? "?new" : "?first&new"
            }`;
            router.push(url);
            mutate();
            setFeatureToDuplicate(null);
          }}
        />
      )}
      <Flex align="center" justify="between" gap="3" mt="4" mb="2">
        <Box style={{ flex: 1 }}>
          <h1>Features</h1>
        </Box>
        {!showSetUpFlow && (
          <Box>
            <Tooltip
              body="You don't have permission to add features in this project."
              shouldDisplay={!canViewFeatureModal || !canCreateFeatures}
            >
              <Button
                disabled={!canViewFeatureModal || !canCreateFeatures}
                onClick={() => {
                  setModalOpen(true);
                  track("Viewed Feature Modal", {
                    source: "feature-list",
                  });
                }}
              >
                Add Feature
              </Button>
            </Tooltip>
          </Box>
        )}
      </Flex>
      <Box mt="3">
        <CustomMarkdown page={"featureList"} />
      </Box>
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
                <Tooltip
                  body="You don't have permission to add features in this project."
                  shouldDisplay={!canViewFeatureModal || !canCreateFeatures}
                >
                  <Button
                    disabled={!canViewFeatureModal || !canCreateFeatures}
                    onClick={() => {
                      setModalOpen(true);
                      track("Viewed Feature Modal", {
                        source: "feature-list",
                      });
                    }}
                  >
                    Add Feature
                  </Button>
                </Tooltip>
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
            {!isDemoProject && (
              <Callout status="info" mt="5" mb="3">
                Test what values these features will return for your users from
                the <Link href="/archetypes#simulate">Simulate</Link> page.
              </Callout>
            )}
          </TabsContent>

          <TabsContent value="drafts">
            <FeaturesDraftTable />
          </TabsContent>
        </Tabs>
      )}
    </Box>
  );
}
