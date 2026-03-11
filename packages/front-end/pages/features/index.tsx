import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureInterface, FeatureMetaInfo } from "shared/types/feature";
import { date, datetime } from "shared/dates";
import { featureHasEnvironment } from "shared/util";
import clsx from "clsx";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import LoadingOverlay from "@/components/LoadingOverlay";
import FeatureModal from "@/components/Features/FeatureModal";
import track from "@/services/track";
import Switch from "@/ui/Switch";
import RealTimeFeatureGraph from "@/components/Features/RealTimeFeatureGraph";
import {
  useRealtimeData,
  useEnvironments,
  useFeatureSearch,
} from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/ui/Pagination";
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
import FeatureSearchFilters from "@/components/Search/FeatureSearchFilters";
import { useAuth } from "@/services/auth";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useFeaturesStatus } from "@/hooks/useFeaturesStatus";
import { useFeatureDraftStates } from "@/hooks/useFeatureDraftStates";
import { useFeatureStaleStates } from "@/hooks/useFeatureStaleStates";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import ProjectBadges from "@/components/ProjectBadges";
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

// Feature table column widths (shared by header and body for alignment)
const FEATURE_TABLE_COLUMN_WIDTH = {
  WATCHING: 40,
  FEATURE_KEY_MAX: 200,
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
  const [currentPage, setCurrentPage] = useState(1);
  const [featureToToggleStaleDetection, setFeatureToToggleStaleDetection] =
    useState<FeatureMetaInfo | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{
    featureId: string;
    envId: string;
    state: boolean;
  } | null>(null);

  useAuth();
  const settings = useOrgSettings();
  const showConfirmation = !!settings?.killswitchConfirmation;

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
    showGraphs,
  );

  const statusHook = useFeaturesStatus();
  const draftHook = useFeatureDraftStates();
  const staleHook = useFeatureStaleStates();

  const {
    searchInputProps,
    items,
    SortableTableColumnHeader,
    setSearchValue,
    syntaxFilters,
  } = useFeatureSearch({
    allFeatures: allFeatures as unknown as FeatureInterface[],
    environments,
    environmentStatus: statusHook.environmentStatus,
    draftStates: draftHook.draftStates,
    staleStates: staleHook.staleStates,
    filterResults: !showArchived
      ? (items) => items.filter((f) => !f.archived)
      : undefined,
  });

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

  // fetchSome for visible features when no bulk filter is active
  useEffect(() => {
    const ids = visibleIdsKey ? visibleIdsKey.split(",") : [];
    if (!ids.length) return;
    if (!hasEnvFilter) statusHook.fetchSome(ids);
    if (!hasDraftFilter) draftHook.fetchSome(ids);
    if (!hasStaleFilter) staleHook.fetchSome(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIdsKey]);

  const handleToggle = useCallback(
    async (featureId: string, envId: string, state: boolean) => {
      if (showConfirmation) {
        setConfirmToggle({ featureId, envId, state });
      } else {
        await statusHook.toggle(featureId, envId, state);
        track("Feature Environment Toggle", {
          environment: envId,
          enabled: state,
        });
      }
    },
    [showConfirmation, statusHook],
  );

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

          <Table variant="list" stickyHeader roundedCorners>
            <TableHeader>
              <TableRow>
                <TableColumnHeader
                  style={{ width: FEATURE_TABLE_COLUMN_WIDTH.WATCHING }}
                />
                <SortableTableColumnHeader
                  field="id"
                  style={{
                    maxWidth: FEATURE_TABLE_COLUMN_WIDTH.FEATURE_KEY_MAX,
                  }}
                >
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
                {toggleEnvs.map((en) => (
                  <TableColumnHeader
                    key={en.id}
                    style={{ textAlign: "center" }}
                  >
                    {en.id}
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
                    <Tooltip
                      flipTheme={false}
                      body="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'."
                    />
                  </TableColumnHeader>
                )}
                <TableColumnHeader>Stale</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {featureItems.map((feature) => {
                const draftEntry = draftHook.draftStates[feature.id];

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
                    <TableCell
                      style={{
                        padding: "var(--space-0)",
                        maxWidth: FEATURE_TABLE_COLUMN_WIDTH.FEATURE_KEY_MAX,
                      }}
                    >
                      <Link
                        href={`/features/${feature.id}`}
                        className={clsx("featurename d-block", {
                          "text-muted": feature.archived,
                        })}
                        style={{ padding: "var(--space-3)" }}
                      >
                        <TruncateMiddleWithTooltip
                          text={feature.id}
                          maxChars={23}
                          maxWidth={FEATURE_TABLE_COLUMN_WIDTH.FEATURE_KEY_MAX}
                          flipTheme={false}
                        />
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
                          showEllipsisAtIndex={1}
                          truncateTagChars={15}
                        />
                      </div>
                    </TableCell>
                    {toggleEnvs.map((en) => (
                      <TableCell key={en.id}>
                        <Flex align="center" justify="center">
                          {featureHasEnvironment(
                            feature as unknown as FeatureInterface,
                            en,
                          ) && (
                            <Switch
                              id={`${feature.id}__${en.id}`}
                              disabled={
                                !permissionsUtil.canPublishFeature(
                                  { project: feature.project },
                                  [en.id],
                                )
                              }
                              value={
                                statusHook.environmentStatus[feature.id]?.[
                                  en.id
                                ] ?? false
                              }
                              onChange={(on) =>
                                handleToggle(feature.id, en.id, on)
                              }
                              size="2"
                            />
                          )}
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
                    <TableCell
                      style={{ textAlign: "center", verticalAlign: "middle" }}
                    >
                      <div>
                        {draftEntry ? (
                          <Tooltip
                            flipTheme={false}
                            body="This feature has an active draft that has not been published yet"
                          >
                            <span
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: "var(--red-9)",
                                flexShrink: 0,
                              }}
                              aria-hidden
                            />
                          </Tooltip>
                        ) : null}
                      </div>
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
                        <RealTimeFeatureGraph
                          data={usage?.[feature.id]?.realtime || []}
                          yDomain={usageDomain}
                        />
                      </TableCell>
                    )}
                    <TableCell style={{ textAlign: "left" }}>
                      <StaleFeatureIcon
                        context="list"
                        neverStale={feature.neverStale}
                        valueType={feature.valueType}
                        staleData={staleHook.getStaleState(feature.id)}
                        fetchStaleData={async () => {
                          staleHook.invalidate([feature.id]);
                          await staleHook.fetchSome([feature.id]);
                        }}
                        onDisable={
                          permissionsUtil.canViewFeatureModal(feature.project)
                            ? () => setFeatureToToggleStaleDetection(feature)
                            : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!items.length && (
                <TableRow>
                  <TableCell
                    colSpan={
                      6 +
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
    if (projects?.length) {
      // If "All Projects" is selected, check if user has permissions for at least one project

      return projects.some(
        (p) =>
          permissionsUtil.canCreateFeature({ project: p.id }) &&
          permissionsUtil.canManageFeatureDrafts({ project: p.id }),
      );
    }
    // No projects - fall back to global permission check (e.g. admin in new org)
    return (
      permissionsUtil.canCreateFeature({ project: "" }) &&
      permissionsUtil.canManageFeatureDrafts({ project: "" })
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

  // Ignore the demo datasource
  const hasFeatures = allFeatures.some(
    (f) =>
      f.project !==
      getDemoDatasourceProjectIdForOrganization(organization.id || ""),
  );

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
    <div className="contents container pagecontents">
      {confirmToggle && (
        <Modal
          trackingEventModalType=""
          header="Toggle environment"
          close={() => setConfirmToggle(null)}
          open={true}
          cta="Confirm"
          useRadixButton={true}
          submit={async () => {
            await statusHook.toggle(
              confirmToggle.featureId,
              confirmToggle.envId,
              confirmToggle.state,
            );
            track("Feature Environment Toggle", {
              environment: confirmToggle.envId,
              enabled: confirmToggle.state,
            });
            setConfirmToggle(null);
          }}
        >
          You are about to set the <strong>{confirmToggle.envId}</strong>{" "}
          environment to{" "}
          <strong>{confirmToggle.state ? "enabled" : "disabled"}</strong>.
        </Modal>
      )}
      {modalOpen && (
        <FeatureModal
          cta="Create"
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${
              hasFeatures ? "?new" : "?first&new"
            }`;
            router.push(url);
            mutate();
          }}
        />
      )}
      {featureToToggleStaleDetection && (
        <StaleDetectionModal
          close={() => setFeatureToToggleStaleDetection(null)}
          feature={featureToToggleStaleDetection}
          mutate={mutate}
          onEnable={async () => {
            const id = featureToToggleStaleDetection.id;
            staleHook.invalidate([id]);
            await staleHook.fetchSome([id]);
          }}
        />
      )}
      <div className="row my-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {!showSetUpFlow && canViewFeatureModal && canCreateFeatures && (
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
                canViewFeatureModal &&
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
