import { ReactNode, useMemo, useState } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { date } from "shared/dates";
import { getMetricLink } from "shared/experiments";
import { ApiContextualBanditInterface } from "shared/validators";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { contextualBanditStatusIndicatorData } from "@/services/contextualBandits";
import { jsonToConds, useAttributeMap } from "@/services/features";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Metadata from "@/ui/Metadata";
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
import ContextualBanditVariations from "@/components/ContextualBandit/ContextualBanditVariations";
import ContextualBanditLinkedFeatures from "@/components/ContextualBandit/ContextualBanditLinkedFeatures";
import StartContextualBanditModal from "@/components/ContextualBandit/StartContextualBanditModal";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";

function OverviewSection({
  title,
  onEdit,
  editLabel = "Edit",
  children,
}: {
  title: string;
  onEdit?: (() => void) | null;
  editLabel?: string;
  children: ReactNode;
}) {
  return (
    <Frame>
      <Flex align="start" justify="between" mb="3" gap="3">
        <Heading as="h4" size="small" mb="0">
          {title}
        </Heading>
        {onEdit ? (
          <Button variant="ghost" onClick={onEdit}>
            {editLabel}
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
  editOverview,
  editAnalysisMetrics,
  editVariations,
  editTrafficTargeting,
  editTags,
  editProject,
  editDescription,
  duplicate,
  linkedFeatures = [],
  linkedFeaturesMutate,
  setFeatureModal,
  canAddFeature = false,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  canRun?: boolean;
  editOverview?: () => void;
  editAnalysisMetrics?: () => void;
  editVariations?: () => void;
  editTrafficTargeting?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  editDescription?: () => void;
  duplicate?: () => void;
  linkedFeatures?: LinkedFeatureInfo[];
  linkedFeaturesMutate?: () => void;
  setFeatureModal?: (open: boolean) => void;
  canAddFeature?: boolean;
}) {
  const { getDatasourceById, getExperimentMetricById, projects } =
    useDefinitions();
  const { apiCall } = useAuth();
  const { contextualBanditQueriesMap } = useContextualBanditQueries(
    cb.datasource,
  );
  const [confirmStop, setConfirmStop] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const updateEndpoint = `/api/v1/contextual-bandits/${cb.id}`;

  const datasource = cb.datasource ? getDatasourceById(cb.datasource) : null;
  const datasourceName = datasource?.name ?? cb.datasource;
  const exposureQueryName =
    contextualBanditQueriesMap.get(cb.contextualBanditQueryId)?.name ??
    cb.contextualBanditQueryId;
  const projectName =
    projects.find((p) => p.id === cb.project)?.name ?? cb.project ?? "None";
  const metricName = (id: string) => getExperimentMetricById(id)?.name ?? id;

  const showResultsTab = cb.status !== "draft";

  const coveragePct = cb.coverage != null ? Math.round(cb.coverage * 100) : 100;

  const formatConversionWindow = (value: number, unit: string): string =>
    `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;

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

  const formatExploratoryStage = (
    value?: number,
    unit?: "days" | "hours",
  ): string => {
    const v = value ?? 1;
    const base = (unit ?? "days") === "days" ? "day" : "hour";
    return `${v} ${base}${v !== 1 ? "s" : ""}`;
  };
  const formatUpdateCadence = (
    value?: number,
    unit?: "days" | "hours",
  ): string => {
    const v = value ?? 1;
    return `Every ${v} ${(unit ?? "days") === "days" ? "days" : "hours"}`;
  };

  const start = async () => {
    await apiCall(`${updateEndpoint}/start`, { method: "POST" });
    mutate();
  };
  const stop = async () => {
    await apiCall(`${updateEndpoint}/stop`, { method: "POST" });
    mutate();
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
      <em>none</em>
    );

  return (
    <Box>
      <Flex direction="row" align="start" justify="between" gap="5">
        <Box>
          <h1
            className="mb-0"
            style={{ display: "inline", verticalAlign: "middle" }}
          >
            {cb.name}
          </h1>
          <Box
            ml="2"
            mt="1"
            display="inline-block"
            style={{ userSelect: "none" }}
          >
            <ExperimentStatusIndicator
              experimentData={contextualBanditStatusIndicatorData(cb)}
            />
          </Box>
        </Box>

        <Flex direction="row" align="center" gap="2" flexShrink="0">
          {canRun && cb.status === "draft" ? (
            <Button onClick={() => setShowStart(true)}>
              Start Contextual Bandit
            </Button>
          ) : null}
          {canRun && cb.status === "running" ? (
            <Button
              variant="outline"
              color="red"
              onClick={() => setConfirmStop(true)}
            >
              Stop Contextual Bandit
            </Button>
          ) : null}
          {editOverview || duplicate ? (
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
              <DropdownMenuGroup>
                {editOverview ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setDropdownOpen(false);
                      editOverview();
                    }}
                  >
                    Edit info
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              {editOverview && duplicate ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                {duplicate ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setDropdownOpen(false);
                      duplicate();
                    }}
                  >
                    Duplicate
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenu>
          ) : null}
        </Flex>
      </Flex>

      <div className="pb-3">
        <Flex gap="3" mt="2" mb="1" wrap="wrap" align="center">
          <Metadata
            label="Project"
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
                    +Add
                  </Link>
                ) : (
                  <Text weight="regular" color="text-mid">
                    None
                  </Text>
                )}
              </Flex>
            }
          />
          <Metadata label="Experiment Key" value={cb.trackingKey || "None"} />
          <Metadata
            label="Owner"
            value={<Owner ownerId={cb.owner} gap="1" textColor="text-mid" />}
          />
          <Metadata label="Created" value={date(cb.dateCreated)} />
        </Flex>
        <div className="row mt-2">
          <div className="col-auto">
            <Metadata
              label="Tags"
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
                          Edit
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
                      +Add
                    </Link>
                  ) : (
                    <Text size="small" color="text-low">
                      None
                    </Text>
                  )}
                </Flex>
              }
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" persistInURL={true}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {showResultsTab ? (
            <TabsTrigger value="results">Results</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview">
          <Box pt="4">
            <Frame>
              <Flex align="start" justify="between" mb="2" gap="3">
                <Heading as="h4" size="small" mb="0">
                  Description
                </Heading>
                {editDescription ? (
                  <Button variant="ghost" onClick={editDescription}>
                    Edit
                  </Button>
                ) : null}
              </Flex>
              {cb.description ? (
                <Markdown>{cb.description}</Markdown>
              ) : (
                <Text color="text-low">
                  <em>
                    Add context about this contextual bandit for your team
                  </em>
                </Text>
              )}
            </Frame>

            <Heading as="h2" size="large" mt="5" mb="3">
              Implementation
            </Heading>

            <Frame>
              <ContextualBanditVariations
                cb={cb}
                canEdit={!!editVariations}
                editVariations={editVariations}
              />
            </Frame>

            <ContextualBanditLinkedFeatures
              cb={cb}
              linkedFeatures={linkedFeatures}
              canAddFeature={canAddFeature}
              setFeatureModal={setFeatureModal}
              mutate={linkedFeaturesMutate}
            />

            <OverviewSection
              title="Traffic & Targeting"
              onEdit={editTrafficTargeting}
            >
              <Grid columns="3" gap="4">
                <DetailSectionColumn label="Traffic">
                  {coveragePct}% included
                </DetailSectionColumn>
                <DetailSectionColumn label="Assignment Attribute">
                  <Flex align="center" gap="1" wrap="wrap">
                    <AttributeBadge attributeId={cb.hashAttribute || "id"} />
                  </Flex>
                </DetailSectionColumn>
              </Grid>
              <Grid columns="3" gap="4" mt="4">
                {hasConfiguredTargeting ? (
                  <>
                    <DetailSectionColumn label="Attribute Targeting">
                      {cb.condition && cb.condition !== "{}" ? (
                        <ConditionDisplay condition={cb.condition} />
                      ) : (
                        <Text color="text-mid">--</Text>
                      )}
                    </DetailSectionColumn>
                    <DetailSectionColumn label="Saved Group Targeting">
                      {cb.savedGroups?.length ? (
                        <SavedGroupTargetingDisplay
                          savedGroups={cb.savedGroups}
                        />
                      ) : (
                        <Text color="text-mid">--</Text>
                      )}
                    </DetailSectionColumn>
                    <DetailSectionColumn label="Prerequisite Targeting">
                      {cb.prerequisites?.length ? (
                        <ConditionDisplay prerequisites={cb.prerequisites} />
                      ) : (
                        <Text color="text-mid">--</Text>
                      )}
                    </DetailSectionColumn>
                  </>
                ) : (
                  <DetailSectionColumn label="Targeting">
                    <Text color="text-mid">
                      No targeting (Contextual Bandit will include all traffic)
                    </Text>
                  </DetailSectionColumn>
                )}
              </Grid>
              {conflictingAttributes.length > 0 && (
                <Callout status="warning" mt="4">
                  <Flex direction="column" gap="2">
                    <Text as="span">
                      Your attribute targeting overlaps with the Bandit&apos;s
                      contextual attributes. Overlapping targeting can create
                      unreachable variations. Please review your targeting to
                      avoid conflicts.
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
              title="Analysis & Metrics"
              onEdit={editAnalysisMetrics}
            >
              <Grid columns="3" gap="4">
                <DetailSectionColumn label="Data Source">
                  {datasourceName || <em>none</em>}
                </DetailSectionColumn>
                <DetailSectionColumn label="Contextual Bandit Assignment Table">
                  {exposureQueryName || <em>none</em>}
                </DetailSectionColumn>
                <DetailSectionColumn label="Contextual Attributes">
                  {cb.contextualAttributes.length
                    ? cb.contextualAttributes.join(", ")
                    : "—"}
                </DetailSectionColumn>
              </Grid>
              <Grid columns="3" gap="4" mt="4">
                <DetailSectionColumn label="Decision Metric">
                  {renderMetricList(
                    cb.decisionMetric ? [cb.decisionMetric] : [],
                  )}
                </DetailSectionColumn>
                <DetailSectionColumn label="Conversion Window">
                  {conversionWindowOverride ? (
                    conversionWindowOverride
                  ) : decisionMetricWindow ? (
                    <>
                      {formatConversionWindow(
                        decisionMetricWindow.windowValue,
                        decisionMetricWindow.windowUnit,
                      )}{" "}
                      <Text color="text-low">(metric default)</Text>
                    </>
                  ) : (
                    <em>None</em>
                  )}
                </DetailSectionColumn>
              </Grid>
              <Grid columns="3" gap="4" mt="4">
                <DetailSectionColumn label="Exploratory Stage">
                  {formatExploratoryStage(cb.burnInValue, cb.burnInUnit)}
                </DetailSectionColumn>
                <DetailSectionColumn label="Update Cadence">
                  {formatUpdateCadence(cb.scheduleValue, cb.scheduleUnit)}
                </DetailSectionColumn>
              </Grid>
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
      </Tabs>

      {showStart && cb.status === "draft" ? (
        <StartContextualBanditModal
          cb={cb}
          linkedFeatures={linkedFeatures}
          startContextualBandit={start}
          close={() => setShowStart(false)}
        />
      ) : null}

      {confirmStop ? (
        <ConfirmDialog
          title="Stop this Contextual Bandit?"
          content="Stopping freezes the current variation weights. You can review results but the bandit will no longer reweight."
          yesText="Stop"
          onConfirm={async () => {
            await stop();
            setConfirmStop(false);
          }}
          onCancel={() => setConfirmStop(false)}
        />
      ) : null}
    </Box>
  );
}
