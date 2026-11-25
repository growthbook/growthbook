import { contextualBanditEndpoints } from "shared/api-endpoints";
import { Fragment, ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { date } from "shared/dates";
import { getMetricLink } from "shared/experiments";
import {
  ApiContextualBanditInterface,
  getDroppedContextualAttributes,
  getEffectiveContextualAttributes,
} from "shared/validators";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
  Variation,
} from "shared/types/experiment";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { contextualBanditStatusIndicatorData } from "@/services/contextualBandits";
import {
  jsonToConds,
  useAttributeMap,
  useAttributeSchema,
} from "@/services/features";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Metadata from "@/ui/Metadata";
import VariationLabel from "@/ui/VariationLabel";
import SortedTags from "@/components/Tags/SortedTags";
import Markdown from "@/components/Markdown/Markdown";
import Owner from "@/components/Avatar/Owner";
import { tagLinkProps } from "@/services/search";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { DetailSectionColumn } from "@/components/DetailSectionBox";
import ContextualBanditResultsTable from "@/components/ContextualBandit/ContextualBanditResultsTable";
import ContextualBanditHealthTab from "@/components/ContextualBandit/ContextualBanditHealthTab";
import { VariationBox } from "@/components/Experiment/VariationsTable";
import ContextualBanditLinkedChanges from "@/components/ContextualBandit/ContextualBanditLinkedChanges";
import StartContextualBanditModal from "@/components/ContextualBandit/StartContextualBanditModal";
import CompareContextualBanditEventsModal from "@/components/ContextualBandit/CompareContextualBanditEventsModal";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import {
  useContextualBanditHealthIssues,
  useContextualBanditStatusHealth,
} from "@/hooks/useContextualBandits";
import Avatar from "@/ui/Avatar";
import { coveragePercentFormatter } from "@/services/utils";

function OverviewSection({
  title,
  onEdit,
  editLabel,
  children,
}: {
  title: string;
  onEdit?: (() => void) | null;
  editLabel?: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const editLabelText = editLabel === undefined ? t`Edit` : editLabel;
  return (
    <Frame>
      <Flex align="start" justify="between" mb="3" gap="3">
        <Heading as="h4" size="sm" mb="0">
          {title}
        </Heading>
        {onEdit ? (
          <Button variant="ghost" onClick={onEdit}>
            {editLabelText}
          </Button>
        ) : null}
      </Flex>
      {children}
    </Frame>
  );
}

/**
 * CB-native detail page. Consumes the CB API shape directly — no experiment
 * SnapshotProvider/TabbedPage, no phases, no experiment-shaped adapter. Mirrors the experiment
 * detail page visually (header + Overview-tab sections) using Radix Themes for layout/typography
 * and @/ui wrappers for the mandated design-system components. Start/stop live in the header;
 * the leaf heatmap is owned by ContextualBanditResultsTable. Edit affordances render when their
 * callbacks are supplied (wired to the CB-native modals).
 */
export default function ContextualBanditDetailPage({
  cb,
  mutate,
  canRun = false,
  canStop = false,
  canArchive = false,
  canDelete = false,
  editOverview,
  editAnalysisMetrics,
  editVariations,
  editTrafficTargeting,
  editTags,
  editProject,
  editDescription,
  duplicate,
  linkedFeatures = [],
  setFeatureModal,
  visualChangesets = [],
  visualChangesetsLoading = false,
  visualChangesetsError,
  setVisualChangesetModal,
  canAddLinkedChanges = false,
  canEditVisualChangesets = false,
  canRemoveVisualChangesets = false,
  linkedChangesMutate,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  canRun?: boolean;
  canStop?: boolean;
  canArchive?: boolean;
  canDelete?: boolean;
  editOverview?: () => void;
  editAnalysisMetrics?: () => void;
  editVariations?: () => void;
  editTrafficTargeting?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  editDescription?: () => void;
  duplicate?: () => void;
  linkedFeatures?: LinkedFeatureInfo[];
  setFeatureModal?: (open: boolean) => void;
  visualChangesets?: VisualChangesetInterface[];
  visualChangesetsLoading?: boolean;
  visualChangesetsError?: Error;
  setVisualChangesetModal?: (open: boolean) => void;
  canAddLinkedChanges?: boolean;
  canEditVisualChangesets?: boolean;
  canRemoveVisualChangesets?: boolean;
  linkedChangesMutate: () => void;
}) {
  const { t } = useLingui();
  const { getDatasourceById, getExperimentMetricById, projects } =
    useDefinitions();
  const restApiCall = useRestApiCall();
  const { contextualBanditQueriesMap } = useContextualBanditQueries(
    cb.datasource,
  );
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const router = useRouter();
  const [showStart, setShowStart] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);

  const healthIssues = useContextualBanditHealthIssues(cb);
  const statusHealth = useContextualBanditStatusHealth(cb);

  const datasource = cb.datasource ? getDatasourceById(cb.datasource) : null;
  const datasourceName = datasource?.name ?? cb.datasource;
  const exposureQueryName =
    contextualBanditQueriesMap.get(cb.contextualBanditQueryId)?.name ??
    cb.contextualBanditQueryId;
  const projectName =
    projects.find((p) => p.id === cb.project)?.name ?? cb.project ?? t`None`;
  const metricName = (id: string) => getExperimentMetricById(id)?.name ?? id;

  const showResultsTab = cb.status !== "draft";

  const coveragePct = coveragePercentFormatter.format(cb.coverage ?? 1);

  const formatConversionWindow = (value: number, unit: string): string => {
    switch (unit) {
      case "minutes":
        return value === 1 ? t`${value} minute` : t`${value} minutes`;
      case "hours":
        return value === 1 ? t`${value} hour` : t`${value} hours`;
      case "days":
        return value === 1 ? t`${value} day` : t`${value} days`;
      case "weeks":
        return value === 1 ? t`${value} week` : t`${value} weeks`;
      default:
        return `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;
    }
  };

  const decisionMetricObj = cb.decisionMetric
    ? getExperimentMetricById(cb.decisionMetric)
    : null;
  const decisionMetricWindow =
    decisionMetricObj?.windowSettings?.type === "conversion"
      ? decisionMetricObj.windowSettings
      : null;
  const conversionWindowOverride =
    (cb.conversionWindowValue ?? null) !== null &&
    (cb.conversionWindowUnit ?? null) !== null
      ? formatConversionWindow(
          cb.conversionWindowValue as number,
          cb.conversionWindowUnit as string,
        )
      : null;

  const hasConfiguredTargeting =
    (!!cb.condition && cb.condition !== "{}") ||
    (cb.savedGroups?.length ?? 0) > 0 ||
    (cb.prerequisites?.length ?? 0) > 0;

  const attributeMap = useAttributeMap(cb.project);
  const conflictingAttributes = useMemo(() => {
    const contextual = new Set(cb.contextualAttributes);
    if (!contextual.size || !cb.condition || cb.condition === "{}") return [];

    let globalAttributes: string[];
    const conds = jsonToConds(cb.condition, attributeMap);
    if (conds) {
      const fields = new Set<string>();
      conds.forEach((cond) =>
        cond.forEach(({ field }) => {
          if (field !== "$savedGroups" && field !== "$notSavedGroups") {
            fields.add(field);
          }
        }),
      );
      globalAttributes = Array.from(fields);
    } else {
      try {
        globalAttributes = Object.keys(JSON.parse(cb.condition)).filter(
          (k) => !k.startsWith("$"),
        );
      } catch {
        globalAttributes = [];
      }
    }

    return globalAttributes.filter((a) => contextual.has(a));
  }, [cb.condition, cb.contextualAttributes, attributeMap]);

  const globalAttributeSchema = useAttributeSchema(false);
  const { effectiveContextualAttributes, droppedContextualAttributes } =
    useMemo(() => {
      const queryAttrs = contextualBanditQueriesMap.get(
        cb.contextualBanditQueryId,
      )?.targetingAttributeColumns;
      return {
        effectiveContextualAttributes: getEffectiveContextualAttributes(
          cb.contextualAttributes,
          queryAttrs,
          globalAttributeSchema,
        ),
        droppedContextualAttributes: getDroppedContextualAttributes(
          cb.contextualAttributes,
          queryAttrs,
          globalAttributeSchema,
        ),
      };
    }, [
      cb.contextualAttributes,
      cb.contextualBanditQueryId,
      contextualBanditQueriesMap,
      globalAttributeSchema,
    ]);

  const formatExploratoryStage = (
    value?: number,
    unit?: "days" | "hours",
  ): string => {
    const v = value ?? 1;
    if ((unit ?? "days") === "days") {
      return v !== 1 ? t`${v} days` : t`${v} day`;
    }
    return v !== 1 ? t`${v} hours` : t`${v} hour`;
  };
  const formatUpdateCadence = (
    value?: number,
    unit?: "days" | "hours",
  ): string => {
    const v = value ?? 1;
    return (unit ?? "days") === "days"
      ? t`Every ${v} days`
      : t`Every ${v} hours`;
  };

  const pendingVariations = cb.variations
    .map((v, index) => ({ ...v, index }))
    .filter((v) => v.status === "pending");
  const singlePending = pendingVariations.length === 1;
  const featurePendingReason =
    linkedFeatures.length > 0
      ? t`a linked Feature Flag rule to be published`
      : null;
  const visualPendingReason = visualChangesetsError
    ? null
    : visualChangesetsLoading
      ? t`this Contextual Bandit's AI Visual Editor changes to load`
      : visualChangesets.length > 1
        ? singlePending
          ? t`an AI Visual Editor change to be saved for it on every page`
          : t`an AI Visual Editor change to be saved for each of them on every page`
        : visualChangesets.length > 0
          ? singlePending
            ? t`an AI Visual Editor change to be saved for it`
            : t`an AI Visual Editor change to be saved for each of them`
          : null;
  const pendingReasons =
    featurePendingReason && visualPendingReason
      ? t`${featurePendingReason} and ${visualPendingReason}`
      : (featurePendingReason ?? visualPendingReason ?? "");
  const pendingTrafficText = pendingReasons
    ? singlePending
      ? t`is waiting on ${pendingReasons} and will not receive any traffic until then.`
      : t`are waiting on ${pendingReasons} and will not receive any traffic until then.`
    : singlePending
      ? t`is not receiving any traffic yet.`
      : t`are not receiving any traffic yet.`;
  const pendingActivationText = pendingReasons
    ? singlePending
      ? t`It activates automatically once that happens.`
      : t`They activate automatically once that happens.`
    : singlePending
      ? t`It activates automatically once a linked change is ready.`
      : t`They activate automatically once a linked change is ready.`;
  const visualChangesetsErrorMessage = visualChangesetsError?.message;
  const numLinkedFeatures = linkedFeatures.length;

  const numVariations = cb.variations.length;
  const variationCols = numVariations > 4 ? 4 : Math.max(numVariations, 1);
  const banditVariations: Variation[] = useMemo(
    () =>
      cb.variations.map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        description: v.description,
        screenshots: [],
      })),
    [cb.variations],
  );
  const hasUniqueIDs = banditVariations.some((v, i) => v.key !== i + "");

  const experimentForVariations = useMemo<
    Pick<ExperimentInterfaceStringDates, "id" | "status" | "type">
  >(
    () => ({
      id: cb.id,
      status: cb.status,
      type: "multi-armed-bandit",
    }),
    [cb.id, cb.status],
  );

  const start = async () => {
    await restApiCall(contextualBanditEndpoints.startContextualBandit, {
      params: { id: cb.id },
    });
    mutate();
  };
  const stop = async () => {
    await restApiCall(contextualBanditEndpoints.stopContextualBandit, {
      params: { id: cb.id },
    });
    mutate();
  };
  const setArchived = async (archived: boolean) => {
    await restApiCall(contextualBanditEndpoints.updateContextualBandit, {
      params: { id: cb.id },
      body: { archived },
    });
    mutate();
  };
  const deleteContextualBandit = async () => {
    await restApiCall(contextualBanditEndpoints.deleteContextualBandit, {
      params: { id: cb.id },
    });
    await router.push("/contextual-bandits");
  };

  const renderMetricList = (ids: string[]): ReactNode =>
    ids.length ? (
      <ul className="list-unstyled mb-0">
        {ids.map((id) => (
          <li key={id}>
            <Link href={getMetricLink(id)}>{metricName(id)}</Link>
          </li>
        ))}
      </ul>
    ) : (
      <em>
        <Trans>none</Trans>
      </em>
    );

  return (
    <Box>
      <Flex direction="row" align="start" justify="between" gap="5">
        <Flex align="center" gap="2">
          <Heading
            as="h1"
            size="xl"
            weight="semibold"
            overflowWrap="anywhere"
            mb="0"
          >
            {cb.name}
          </Heading>
          <Box style={{ userSelect: "none" }}>
            <ExperimentStatusIndicator
              experimentData={contextualBanditStatusIndicatorData(
                cb,
                statusHealth,
              )}
            />
          </Box>
        </Flex>

        <Flex direction="row" align="center" gap="2" flexShrink="0">
          {canRun && cb.status === "draft" ? (
            <Button onClick={() => setShowStart(true)}>
              <Trans>Start Contextual Bandit</Trans>
            </Button>
          ) : null}
          {canStop && cb.status === "running" ? (
            <Button
              variant="outline"
              color="red"
              onClick={() => setConfirmStop(true)}
            >
              <Trans>Stop Contextual Bandit</Trans>
            </Button>
          ) : null}
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="3"
                highContrast
                ml="2"
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            open={dropdownOpen}
            onOpenChange={(o) => setDropdownOpen(!!o)}
            menuPlacement="end"
          >
            {editOverview ? (
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setDropdownOpen(false);
                    editOverview();
                  }}
                >
                  <Trans>Edit info</Trans>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            ) : null}
            {editOverview ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setDropdownOpen(false);
                  setAuditModal(true);
                }}
              >
                <Trans>Audit history</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {duplicate ? <DropdownMenuSeparator /> : null}
            {duplicate ? (
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setDropdownOpen(false);
                    duplicate();
                  }}
                >
                  <Trans>Duplicate</Trans>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            ) : null}
            {canArchive || canDelete ? <DropdownMenuSeparator /> : null}
            {canArchive || canDelete ? (
              <DropdownMenuGroup>
                {canArchive ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setDropdownOpen(false);
                      setConfirmArchive(true);
                    }}
                  >
                    {cb.archived ? t`Unarchive` : t`Archive`}
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <DropdownMenuItem
                    color="red"
                    disabled={cb.status === "running"}
                    tooltip={
                      cb.status === "running"
                        ? t`Stop this Contextual Bandit before deleting it`
                        : undefined
                    }
                    onClick={() => {
                      setDropdownOpen(false);
                      setConfirmDelete(true);
                    }}
                  >
                    <Trans>Delete</Trans>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenu>
        </Flex>
      </Flex>

      <div className="pb-3">
        <Flex gap="3" mt="2" mb="1" wrap="wrap" align="center">
          <Metadata
            label={t`Project`}
            value={
              <Flex gap="1" align="center">
                {cb.project ? (
                  <Text weight="regular" color="text-mid">
                    {projectName}
                  </Text>
                ) : editProject ? (
                  <Link
                    onClick={(e) => {
                      e.preventDefault();
                      editProject();
                    }}
                  >
                    <Trans>+Add</Trans>
                  </Link>
                ) : (
                  <Text weight="regular" color="text-mid">
                    <Trans>None</Trans>
                  </Text>
                )}
              </Flex>
            }
          />
          <Metadata
            label={t`Experiment Key`}
            value={cb.trackingKey || t`None`}
          />
          <Metadata
            label={t`Owner`}
            value={<Owner ownerId={cb.owner} gap="1" textColor="text-mid" />}
          />
          <Metadata label={t`Created`} value={date(cb.dateCreated)} />
        </Flex>
        <div className="row mt-2">
          <div className="col-auto">
            <Metadata
              label={t`Tags`}
              value={
                <Flex gap="1" align="center">
                  {cb.tags.length ? (
                    <>
                      <SortedTags
                        tags={cb.tags}
                        useFlex
                        shouldShowEllipsis={false}
                        {...tagLinkProps("contextual-bandits")}
                      />
                      {editTags ? (
                        <Link
                          onClick={(e) => {
                            e.preventDefault();
                            editTags();
                          }}
                        >
                          <Trans>Edit</Trans>
                        </Link>
                      ) : null}
                    </>
                  ) : editTags ? (
                    <Link
                      onClick={(e) => {
                        e.preventDefault();
                        editTags();
                      }}
                    >
                      <Trans>+Add</Trans>
                    </Link>
                  ) : (
                    <Text size="sm" color="text-low">
                      <Trans>None</Trans>
                    </Text>
                  )}
                </Flex>
              }
            />
          </div>
        </div>
      </div>

      <Tabs
        defaultValue={cb.status === "running" ? "results" : "overview"}
        persistInURL={true}
      >
        <TabsList>
          <TabsTrigger value="overview">
            <Trans>Overview</Trans>
          </TabsTrigger>
          {showResultsTab ? (
            <>
              <TabsTrigger value="results">
                <Trans>Results</Trans>
              </TabsTrigger>
              <TabsTrigger value="health">
                <Trans>Health</Trans>
                {healthIssues.length > 0 ? (
                  <Avatar size="sm" ml="2" color="red">
                    {healthIssues.length}
                  </Avatar>
                ) : null}
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>

        <TabsContent value="overview">
          <Box pt="4">
            <Frame>
              <Flex align="start" justify="between" mb="2" gap="3">
                <Heading as="h4" size="sm" mb="0">
                  <Trans>Description</Trans>
                </Heading>
                {editDescription ? (
                  <Button variant="ghost" onClick={editDescription}>
                    <Trans>Edit</Trans>
                  </Button>
                ) : null}
              </Flex>
              {cb.description ? (
                <Markdown>{cb.description}</Markdown>
              ) : (
                <Text color="text-low">
                  <em>
                    <Trans>
                      Add context about this Contextual Bandit for your team
                    </Trans>
                  </em>
                </Text>
              )}
            </Frame>

            <Heading as="h2" size="lg" mt="5" mb="3">
              <Trans>Implementation</Trans>
            </Heading>

            <Frame>
              <Box>
                <Flex justify="between" align="center" mb="3" mx="1" gap="3">
                  <Heading color="text-high" as="h4" size="sm" mb="0">
                    <Trans>Variations</Trans>
                  </Heading>
                  {editVariations ? (
                    <Button variant="ghost" onClick={editVariations}>
                      <Trans>Edit Variations</Trans>
                    </Button>
                  ) : null}
                </Flex>

                {pendingVariations.length > 0 && (
                  <Callout status="warning" mb="4">
                    <Flex align="center" gap="2" wrap="wrap">
                      {pendingVariations.map((v) => (
                        <Box key={v.id} flexShrink="0">
                          <VariationLabel
                            number={v.index}
                            name={v.name}
                            size="sm"
                            disableTooltip
                          />
                        </Box>
                      ))}
                      <Text>
                        {pendingTrafficText}{" "}
                        {visualChangesetsError ? (
                          <Trans>
                            Couldn&apos;t load this Contextual Bandit&apos;s
                            visual changes ({visualChangesetsErrorMessage}).
                            Reload the page and try again.
                          </Trans>
                        ) : (
                          pendingActivationText
                        )}
                      </Text>
                    </Flex>
                  </Callout>
                )}

                <Grid
                  gap="4"
                  style={{ gridAutoRows: "1fr" }}
                  columns={{
                    initial: "1",
                    xs: "2",
                    sm: variationCols === 2 ? "2" : "3",
                    md: variationCols.toString(),
                  }}
                >
                  {banditVariations.map((v, i) => (
                    <Box key={v.id} height="100%">
                      <VariationBox
                        i={i}
                        v={v}
                        experiment={experimentForVariations}
                        showIds={hasUniqueIDs}
                        allowImages={false}
                        showSplit={false}
                      />
                    </Box>
                  ))}
                </Grid>
              </Box>
            </Frame>

            <ContextualBanditLinkedChanges
              cb={cb}
              linkedFeatures={linkedFeatures}
              visualChangesets={visualChangesets}
              visualChangesetsLoading={visualChangesetsLoading}
              visualChangesetsError={visualChangesetsError}
              canAdd={canAddLinkedChanges}
              canEditVisualChangesets={canEditVisualChangesets}
              canRemoveVisualChangesets={canRemoveVisualChangesets}
              setFeatureModal={setFeatureModal}
              setVisualChangesetModal={setVisualChangesetModal}
              mutate={linkedChangesMutate}
            />

            <OverviewSection
              title={t`Traffic & Targeting`}
              onEdit={editTrafficTargeting}
            >
              <Grid columns="3" gap="4">
                <DetailSectionColumn label={t`Traffic`}>
                  <Trans>{coveragePct} included</Trans>
                </DetailSectionColumn>
                <DetailSectionColumn label={t`Assignment Attribute`}>
                  <Flex align="center" gap="1" wrap="wrap">
                    <AttributeBadge attributeId={cb.hashAttribute || "id"} />
                  </Flex>
                </DetailSectionColumn>
              </Grid>
              <Grid columns="3" gap="4" mt="4">
                {hasConfiguredTargeting ? (
                  <>
                    <DetailSectionColumn label={t`Attribute Targeting`}>
                      {cb.condition && cb.condition !== "{}" ? (
                        <ConditionDisplay condition={cb.condition} />
                      ) : (
                        <Text color="text-mid">--</Text>
                      )}
                    </DetailSectionColumn>
                    <DetailSectionColumn label={t`Saved Group Targeting`}>
                      {cb.savedGroups?.length ? (
                        <SavedGroupTargetingDisplay
                          savedGroups={cb.savedGroups}
                        />
                      ) : (
                        <Text color="text-mid">--</Text>
                      )}
                    </DetailSectionColumn>
                    <DetailSectionColumn label={t`Prerequisite Targeting`}>
                      {cb.prerequisites?.length ? (
                        <ConditionDisplay prerequisites={cb.prerequisites} />
                      ) : (
                        <Text color="text-mid">--</Text>
                      )}
                    </DetailSectionColumn>
                  </>
                ) : (
                  <DetailSectionColumn label={t`Targeting`}>
                    <Text color="text-mid">
                      <Trans>
                        No targeting (Contextual Bandit will include all
                        traffic)
                      </Trans>
                    </Text>
                  </DetailSectionColumn>
                )}
              </Grid>
              {conflictingAttributes.length > 0 && (
                <Callout status="info" mt="4">
                  <Flex direction="column" gap="2">
                    <Text as="span">
                      <Trans>
                        Your attribute targeting overlaps with the Bandit&apos;s
                        contextual attributes. Overlapping targeting can create
                        unreachable variations. Please review your targeting to
                        avoid conflicts.
                      </Trans>
                    </Text>
                    <Flex align="center" gap="1" wrap="wrap">
                      {conflictingAttributes.map((a) => (
                        <AttributeBadge key={a} attributeId={a} />
                      ))}
                    </Flex>
                  </Flex>
                </Callout>
              )}
            </OverviewSection>

            <OverviewSection
              title={t`Analysis & Metrics`}
              onEdit={editAnalysisMetrics}
            >
              <Grid columns="3" gap="4">
                <DetailSectionColumn label={t`Data Source`}>
                  {datasourceName || (
                    <em>
                      <Trans>none</Trans>
                    </em>
                  )}
                </DetailSectionColumn>
                <DetailSectionColumn
                  label={t`Contextual Bandit Assignment Table`}
                >
                  {exposureQueryName || (
                    <em>
                      <Trans>none</Trans>
                    </em>
                  )}
                </DetailSectionColumn>
                <DetailSectionColumn label={t`Contextual Attributes`}>
                  {effectiveContextualAttributes.length
                    ? effectiveContextualAttributes.map((a, i) => (
                        <Fragment key={a}>
                          {i ? ", " : ""}
                          <code>{a}</code>
                        </Fragment>
                      ))
                    : "—"}
                </DetailSectionColumn>
              </Grid>
              <Grid columns="3" gap="4" mt="4">
                <DetailSectionColumn label={t`Decision Metric`}>
                  {renderMetricList(
                    cb.decisionMetric ? [cb.decisionMetric] : [],
                  )}
                </DetailSectionColumn>
                <DetailSectionColumn label={t`Conversion Window`}>
                  {conversionWindowOverride ? (
                    conversionWindowOverride
                  ) : decisionMetricWindow ? (
                    <>
                      {formatConversionWindow(
                        decisionMetricWindow.windowValue,
                        decisionMetricWindow.windowUnit,
                      )}{" "}
                      <Text color="text-low">
                        <Trans>(metric default)</Trans>
                      </Text>
                    </>
                  ) : (
                    <em>
                      <Trans>None</Trans>
                    </em>
                  )}
                </DetailSectionColumn>
              </Grid>
              <Grid columns="3" gap="4" mt="4">
                <DetailSectionColumn label={t`Exploratory Stage`}>
                  {formatExploratoryStage(cb.burnInValue, cb.burnInUnit)}
                </DetailSectionColumn>
                <DetailSectionColumn label={t`Update Cadence`}>
                  {formatUpdateCadence(cb.scheduleValue, cb.scheduleUnit)}
                </DetailSectionColumn>
                <DetailSectionColumn label={t`Prior variation sample size`}>
                  {(cb.priorSampleSize ?? 0) > 0 ? (
                    cb.priorSampleSize
                  ) : (
                    <em>
                      <Trans>None</Trans>
                    </em>
                  )}
                </DetailSectionColumn>
              </Grid>
              {droppedContextualAttributes.length > 0 && (
                <Callout status="warning" mt="4">
                  <Flex direction="column" gap="2">
                    <Text as="span">
                      <Trans>
                        These attributes were removed from the Contextual Bandit
                        query or your organization&apos;s attributes and are no
                        longer used. Edit the analysis settings to update them.
                      </Trans>
                    </Text>
                    <Flex align="center" gap="1" wrap="wrap">
                      {droppedContextualAttributes.map((a) => (
                        <AttributeBadge key={a} attributeId={a} />
                      ))}
                    </Flex>
                  </Flex>
                </Callout>
              )}
            </OverviewSection>
          </Box>
        </TabsContent>

        {showResultsTab ? (
          <TabsContent value="results">
            <Box pt="4">
              <Frame>
                <ContextualBanditResultsTable cb={cb} mutate={mutate} />
              </Frame>
            </Box>
          </TabsContent>
        ) : null}

        {showResultsTab ? (
          <TabsContent value="health">
            <Box pt="4">
              <ContextualBanditHealthTab cb={cb} />
            </Box>
          </TabsContent>
        ) : null}
      </Tabs>

      {showStart && cb.status === "draft" ? (
        <StartContextualBanditModal
          cb={cb}
          linkedFeatures={linkedFeatures}
          visualChangesets={visualChangesets}
          visualChangesetsLoading={visualChangesetsLoading}
          visualChangesetsError={visualChangesetsError}
          startContextualBandit={start}
          close={() => setShowStart(false)}
        />
      ) : null}

      {auditModal ? (
        <CompareContextualBanditEventsModal
          cbId={cb.id}
          onClose={() => setAuditModal(false)}
        />
      ) : null}

      {confirmStop ? (
        <ConfirmDialog
          title={t`Stop this Contextual Bandit?`}
          content={t`Stopping freezes the current variation weights. You can review results but the bandit will no longer reweight.`}
          yesText={t`Stop`}
          onConfirm={async () => {
            await stop();
            setConfirmStop(false);
          }}
          onCancel={() => setConfirmStop(false)}
        />
      ) : null}
      {confirmArchive ? (
        <ConfirmDialog
          title={
            cb.archived
              ? t`Unarchive this Contextual Bandit?`
              : t`Archive this Contextual Bandit?`
          }
          content={
            <>
              <Text as="p">
                {cb.archived
                  ? t`It will show up in the main list again and can be edited.`
                  : t`It will move to the Archived tab and can't be edited until it is unarchived.`}
              </Text>
              {cb.status === "running" ? (
                <Callout status="warning">
                  {cb.archived
                    ? t`This Contextual Bandit is still running and will resume serving to its linked Feature Flags.`
                    : t`This will immediately stop all linked Feature Flags from serving this Contextual Bandit.`}
                </Callout>
              ) : null}
            </>
          }
          yesText={cb.archived ? t`Unarchive` : t`Archive`}
          color={cb.archived ? "violet" : "red"}
          onConfirm={async () => {
            await setArchived(!cb.archived);
            setConfirmArchive(false);
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title={t`Delete this Contextual Bandit?`}
          content={
            <>
              <Text as="p">
                <Trans>
                  Its results history will be deleted. This can&apos;t be
                  undone.
                </Trans>
              </Text>
              {numLinkedFeatures > 0 ? (
                <Callout status="warning">
                  <Plural
                    value={numLinkedFeatures}
                    one="# linked Feature Flag will keep a rule pointing to this Contextual Bandit. Remove the rule from each flag if it is no longer needed."
                    other="# linked Feature Flags will keep a rule pointing to this Contextual Bandit. Remove the rule from each flag if it is no longer needed."
                  />
                </Callout>
              ) : null}
            </>
          }
          yesText={t`Delete`}
          color="red"
          onConfirm={deleteContextualBandit}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </Box>
  );
}
