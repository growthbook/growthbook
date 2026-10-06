import { Fragment, ReactNode, useCallback, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { PRESET_DECISION_CRITERIAS } from "shared/enterprise";
import { isMetricGroupId } from "shared/experiments";
import { format } from "date-fns-tz";
import clsx from "clsx";
import { PiCaretRight, PiInfo } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { Select, SelectItem } from "@/ui/Select";
import TextField from "@/ui/TextField";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import planStyles from "./AnalysisPlan.module.scss";
import GreyContainer from "./GreyContainer";
import GoalMetricPopover from "./GoalMetricPopover";
import SetupDateField, { SETUP_DATE_FIELD_PX } from "./SetupDateField";
import { EditButton } from "./SetupFunnel";
import DecisionRulesPopover from "./DecisionRulesPopover";
import StatsSettingsFields from "./StatsSettingsFields";
import Collapse from "./Collapse";
import AdvancedAnalysisFields, {
  AdvancedAnalysisState,
} from "./AdvancedAnalysisFields";
import { SetupDraft } from "./setupDraft";

// Design values: a 176px label column for every Analysis Plan row, and 128px
// for the labels inside the Timing and Decision containers (the design's
// 110px, widened in review so "If no clear winner" and its info icon fit on
// one line; every inner label shares it, so the fields still line up).
const ROW_LABEL_PX = 176;
const INNER_LABEL_PX = 128;

// The Timing and Decision controls' shared width (set in review): Ends'
// "On Date" pair, the 140px mode select, InnerRow's 12px gap (gap="3") and
// the 208px date field. Ends' "After" [n] [Days] fills the same width (Days
// takes what's left), and every Decision select matches it, so all their
// right edges line up.
const ENDS_MODE_PX = 140;
const ENDS_NUMBER_PX = 70;
const CONTROL_GAP_PX = 12;
// Starts' and Ends' date fields, set in review.
const DATE_FIELD_PX = SETUP_DATE_FIELD_PX;
const CONTROLS_PX = ENDS_MODE_PX + CONTROL_GAP_PX + DATE_FIELD_PX;
const ENDS_UNIT_PX =
  CONTROLS_PX -
  (ENDS_MODE_PX + CONTROL_GAP_PX + ENDS_NUMBER_PX + CONTROL_GAP_PX);
// If no clear winner → Ship a variation: the two selects together.
const NO_WINNER_PX = 200;

function RowLabel({
  children,
  info,
  paddingTop = 9,
}: {
  children: ReactNode;
  info?: string;
  paddingTop?: number;
}) {
  return (
    <Flex
      align="center"
      gap="1"
      style={{ flex: `0 0 ${ROW_LABEL_PX}px`, paddingTop }}
    >
      {/* Regular (400), trialled in review. */}
      <Text weight="regular">{children}</Text>
      {info ? (
        <Tooltip content={info}>
          <Flex style={{ color: "var(--slate-10)" }}>
            <PiInfo size={14} />
          </Flex>
        </Tooltip>
      ) : null}
    </Flex>
  );
}

// labelPaddingTop moves the label down to line up with something inside the
// row; by default (9px) it centres on a metric field.
function Row({
  label,
  info,
  children,
  labelPaddingTop,
}: {
  label: string;
  info?: string;
  children: ReactNode;
  labelPaddingTop?: number;
}) {
  return (
    <Flex align="start">
      <RowLabel info={info} paddingTop={labelPaddingTop}>
        {label}
      </RowLabel>
      {/* 10px narrower, taken from the left so the right edge stays in line
        with the rest of the page (set in review): the metric fields and the
        Timing and Decision boxes. */}
      <Box flexGrow="1" minWidth="0" style={{ marginLeft: 10 }}>
        {children}
      </Box>
    </Flex>
  );
}

function InnerRow({
  label,
  info,
  className,
  children,
}: {
  label: string;
  info?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Flex align="center" gap="3" wrap="wrap" className={className}>
      <Flex align="center" gap="1" style={{ flex: `0 0 ${INNER_LABEL_PX}px` }}>
        {/* No colour: the page's --gray-12, the same as the section headings
          (set in review). */}
        {/* Never wraps (set in review). */}
        <Text size="sm" whiteSpace="nowrap">
          {label}
        </Text>
        {info ? (
          <Tooltip content={info}>
            <Flex style={{ color: "var(--slate-10)" }}>
              <PiInfo size={12} />
            </Flex>
          </Tooltip>
        ) : null}
      </Flex>
      {children}
    </Flex>
  );
}

// Where Timing's and Decision's labels sit, to be centred on their grey
// box's first row (Starts; Decision Criteria), set in review: the box's 16px
// padding, plus half of what the first row's taller than the label's 20px
// line. That row is a 32px select when editable, or a 20px line of text.
function firstInnerRowLabelTop(firstRowEditable: boolean): number {
  return 16 + ((firstRowEditable ? 32 : 20) - 20) / 2;
}

const READ_ONLY_METRICS_TOP_PX = 9;

// renderChip replaces a chip's default badge, given the metric's name.
function MetricChips({
  ids,
  renderChip,
}: {
  ids: string[];
  renderChip?: (id: string, name: string) => ReactNode;
}) {
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();
  // Read-only: the first row of chips, or "None", centred on the row's
  // label (fixed in review). The label's 20px line starts 9px down (Row's
  // default labelPaddingTop), so its centre is 19px down; a chip (Badge's
  // Radix size 1) and "None"'s line are both 20px tall, so 9px above them
  // too.
  if (!ids.length)
    return (
      <Box style={{ paddingTop: READ_ONLY_METRICS_TOP_PX }}>
        {/* "None" rather than the dash other empty values use, in the
          same colour as the other read-only values, e.g. At End (both set
          in review). */}
        <Text>None</Text>
      </Box>
    );
  return (
    <Flex gap="2" wrap="wrap" style={{ paddingTop: READ_ONLY_METRICS_TOP_PX }}>
      {ids.map((id) => {
        const name =
          getExperimentMetricById(id)?.name ??
          getMetricGroupById(id)?.name ??
          id;
        return renderChip ? (
          <Fragment key={id}>{renderChip(id, name)}</Fragment>
        ) : (
          <Badge key={id} label={name} color="gray" variant="soft" />
        );
      })}
    </Flex>
  );
}

const START_LABELS: Record<SetupDraft["startMode"], string> = {
  manual: "Manually",
  date: "On Date",
};
const END_LABELS: Record<SetupDraft["endMode"], string> = {
  after: "After",
  stopped: "Manually",
  date: "On Date",
};
const AT_END_LABELS: Record<SetupDraft["atEnd"], string> = {
  notify: "Notify only — keep running",
  "ship-winner": "Ship the winning variation",
};
const NO_WINNER_LABELS: Record<SetupDraft["noClearWinner"], string> = {
  "keep-running": "Keep running",
  "ship-variation": "Ship a specific variation",
};

// One of the four settings sections inside Advanced (set in review), each
// in its own card, always open: a title, then its fields, with 24px of
// padding on every side (.settingsCard).
//
// FALLBACK: a plain Box styled as the Setup page's cards (.settingsCard), not
// @/ui/Frame. There's no display Card in @/ui/, and Frame's .appbox restyles
// any .appbox inside it (a darker border and overflow-x: auto), which the
// Metric Overrides cards, the window settings box and the slice cards all
// are: they'd change, and their dropdowns could be clipped.
function SettingsCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Box className={planStyles.settingsCard}>
      {/* The app's card header: @/ui/Heading h4 at "small" (16px), as the
        experiment page's own cards use it (e.g. AnalysisSettings.tsx), at
        weight 500, in the page text colour like the "Advanced" row's text.
        No description under it (removed in review); 24px to the fields. */}
      <Heading as="h4" size="sm" weight="medium" mb="5">
        {title}
      </Heading>
      {children}
    </Box>
  );
}

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  draft: SetupDraft;
  update: (patch: Partial<SetupDraft>) => void;
  editable: boolean;
  // Start timing is locked once a scheduled start has been armed — the same
  // rule the rest of the page applies to nextScheduledStatusUpdate.
  startLocked: boolean;
  // Advanced's stats settings keep the product's own edit rules (editable on
  // a running experiment), independent of the draft-only inline editing.
  canEditAnalysisSettings: boolean;
  // The rest of the analysis settings report their state here, so the page's
  // Save and Discard cover them. See AdvancedAnalysisFields.
  onAdvancedStateChange: (state: AdvancedAnalysisState) => void;
  // While the start is locked to an approved schedule: opens the schedule
  // modal from a hover pencil on the read-only Starts value (set in
  // review). The modal saves on its own, outside the page's draft.
  onEditSchedule?: () => void;
}

export default function AnalysisPlan({
  experiment,
  draft,
  update,
  editable,
  startLocked,
  canEditAnalysisSettings,
  onAdvancedStateChange,
  onEditSchedule,
}: Props) {
  const { organization, hasCommercialFeature } = useUser();
  const { getDecisionCriteria } = useRunningExperimentStatus();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const hasDecisionFramework =
    !!organization?.settings?.decisionFrameworkEnabled &&
    hasCommercialFeature("decision-framework");

  const { data: criteriaData } = useApi<{
    decisionCriteria: DecisionCriteriaData[];
  }>("/decision-criteria", { shouldRun: () => hasDecisionFramework });
  // Whether any criteria's description in the menu wraps to a second line.
  // If one does, every description gets room for two, so the options are
  // all the same height (set in review). Measured as the menu renders.
  const [criteriaTwoLine, setCriteriaTwoLine] = useState(false);
  const measureDescription = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    // Watched rather than measured once: the menu mounts before it's laid
    // out at its final width, when every description is still one line.
    // More than one 16px line (the 12px text's line height) = two lines.
    const observer = new ResizeObserver(() => {
      if (el.scrollHeight > 24) {
        setCriteriaTwoLine(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    // Stop watching once the menu closes and the item goes.
    const stop = new MutationObserver(() => {
      if (!el.isConnected) {
        observer.disconnect();
        stop.disconnect();
      }
    });
    stop.observe(document.body, { childList: true, subtree: true });
  }, []);

  const criteriaOptions = [
    ...PRESET_DECISION_CRITERIAS,
    ...(criteriaData?.decisionCriteria ?? []),
  ];
  // Unset resolves to the org default, same as the rest of the product.
  const selectedCriteria = getDecisionCriteria(
    draft.decisionCriteriaId ?? undefined,
  );

  // A goal metric's chip opens its details and Target MDE (set in review).
  // Metric groups have no Target MDE of their own, so their chips don't.
  // asBadge: read-only, where the chip is a grey Badge, not the field's own.
  const renderGoalMetricLabel = (
    id: string,
    label: ReactNode,
    asBadge = false,
  ) =>
    isMetricGroupId(id) ? (
      asBadge ? (
        <Badge label={<>{label}</>} color="gray" variant="soft" />
      ) : (
        label
      )
    ) : (
      <GoalMetricPopover
        metricId={id}
        asBadge={asBadge}
        override={draft.targetMDEOverrides[id] ?? null}
        onChange={
          editable
            ? (value) => {
                const next = { ...draft.targetMDEOverrides };
                if (value === null) delete next[id];
                else next[id] = value;
                update({ targetMDEOverrides: next });
              }
            : undefined
        }
      >
        {label}
      </GoalMetricPopover>
    );

  const metricsSelectorProps = {
    datasource: experiment.datasource,
    exposureQueryId: experiment.exposureQueryId,
    project: experiment.project,
    includeFacts: true,
    // A tag button in each field instead of a "Select metric by tag" row
    // under it (set in review).
    tagSelect: "menu" as const,
  };

  const startDisplay =
    draft.startMode === "date" && draft.startAt
      ? format(new Date(draft.startAt), "MMM d, yyyy h:mm a (z)")
      : START_LABELS.manual;

  const variations = experiment.variations ?? [];

  return (
    <Box className={planStyles.plan}>
      {/* The id is the To Do list's jump target. */}
      <Box id="setup-analysis-plan" style={{ scrollMarginTop: 120 }}>
        <Heading as="h3" size="sm" weight="medium" mb="0">
          Analysis Plan
        </Heading>
      </Box>

      {/* 24px below the heading, set in review. */}
      <Flex direction="column" gap="4" mt="5">
        <Row
          label="Goal Metrics"
          info="The primary metrics you'll use to decide whether the experiment succeeded."
        >
          {/* The To Do list's "Add a Goal Metric" jump target. */}
          <Box id="setup-goal-metrics">
            {editable ? (
              <MetricsSelector
                {...metricsSelectorProps}
                selected={draft.goalMetrics}
                onChange={(goalMetrics) => update({ goalMetrics })}
                includeGroups
                renderSelectedLabel={renderGoalMetricLabel}
              />
            ) : (
              <MetricChips
                ids={draft.goalMetrics}
                renderChip={(id, name) => renderGoalMetricLabel(id, name, true)}
              />
            )}
          </Box>
        </Row>
        <Row
          label="Secondary Metrics"
          info="Metrics you want to learn from, without using them to decide."
        >
          {editable ? (
            <MetricsSelector
              {...metricsSelectorProps}
              selected={draft.secondaryMetrics}
              onChange={(secondaryMetrics) => update({ secondaryMetrics })}
            />
          ) : (
            <MetricChips ids={draft.secondaryMetrics} />
          )}
        </Row>
        <Row
          label="Guardrail Metrics"
          info="Metrics that shouldn't get worse. A regression here is a reason to stop."
        >
          {editable ? (
            <MetricsSelector
              {...metricsSelectorProps}
              selected={draft.guardrailMetrics}
              onChange={(guardrailMetrics) => update({ guardrailMetrics })}
            />
          ) : (
            <MetricChips ids={draft.guardrailMetrics} />
          )}
        </Row>
      </Flex>

      <Flex direction="column" gap="2" mt="6">
        <Row
          label="Timing"
          labelPaddingTop={firstInnerRowLabelTop(editable && !startLocked)}
        >
          <GreyContainer>
            <Flex direction="column" gap="3">
              {/* With a locked schedule, hovering anywhere on the row shows
                the value's pencil (set in review; .hoverEdit). */}
              <InnerRow
                label="Starts"
                className={
                  startLocked && onEditSchedule
                    ? planStyles.hoverEdit
                    : undefined
                }
              >
                {editable && !startLocked ? (
                  <>
                    <Select
                      value={draft.startMode}
                      setValue={(v) =>
                        update({ startMode: v as SetupDraft["startMode"] })
                      }
                      style={{ width: 140 }}
                    >
                      <SelectItem value="manual">Manually</SelectItem>
                      <SelectItem value="date">On Date</SelectItem>
                    </Select>
                    {draft.startMode === "date" ? (
                      <SetupDateField
                        date={draft.startAt ?? undefined}
                        disableBefore={new Date()}
                        setDate={(d) =>
                          update({ startAt: d ? d.toISOString() : null })
                        }
                      />
                    ) : null}
                  </>
                ) : startLocked && onEditSchedule ? (
                  // The page's pencil (EditButton), shown on hover or focus
                  // of the whole row (.hoverEdit on the InnerRow), 8px after
                  // the value (set in review; was 4px).
                  <Flex align="center" gap="2">
                    <Text>{startDisplay}</Text>
                    <EditButton
                      label="Edit schedule"
                      onClick={onEditSchedule}
                    />
                  </Flex>
                ) : (
                  <Text>{startDisplay}</Text>
                )}
              </InnerRow>
              {/* STUBBED: the experiment model has no end schedule. These
                controls edit the local draft only and are never saved — see
                STUBBED_FIELDS in setupDraft.ts. */}
              <InnerRow label="Ends">
                {editable ? (
                  <>
                    <Select
                      value={draft.endMode}
                      setValue={(v) =>
                        update({ endMode: v as SetupDraft["endMode"] })
                      }
                      style={{ width: ENDS_MODE_PX }}
                    >
                      <SelectItem value="after">After</SelectItem>
                      <SelectItem value="stopped">Manually</SelectItem>
                      <SelectItem value="date">On Date</SelectItem>
                    </Select>
                    {draft.endMode === "after" ? (
                      <>
                        <TextField
                          type="number"
                          min={1}
                          value={String(draft.endAfter)}
                          onChange={(e) =>
                            update({
                              endAfter: Math.max(1, Number(e.target.value)),
                            })
                          }
                          style={{ width: ENDS_NUMBER_PX }}
                        />
                        <Select
                          value={draft.endUnit}
                          setValue={(v) =>
                            update({ endUnit: v as SetupDraft["endUnit"] })
                          }
                          style={{ width: ENDS_UNIT_PX }}
                        >
                          <SelectItem value="days">Days</SelectItem>
                          <SelectItem value="weeks">Weeks</SelectItem>
                        </Select>
                        {/* No colour: --gray-12, the same as the selects'
                          text beside it (set in review). */}
                        <Text>from start</Text>
                      </>
                    ) : draft.endMode === "date" ? (
                      <SetupDateField
                        date={draft.endAt ?? undefined}
                        disableBefore={draft.startAt ?? new Date()}
                        setDate={(d) =>
                          update({ endAt: d ? d.toISOString() : null })
                        }
                      />
                    ) : null}
                  </>
                ) : (
                  <Text>
                    {draft.endMode === "after"
                      ? `After ${draft.endAfter} ${draft.endUnit} from start`
                      : draft.endMode === "date" && draft.endAt
                        ? format(new Date(draft.endAt), "MMM d, yyyy h:mm a")
                        : END_LABELS[draft.endMode]}
                  </Text>
                )}
              </InnerRow>
            </Flex>
          </GreyContainer>
        </Row>

        {hasDecisionFramework ? (
          <Row
            label="Decision"
            labelPaddingTop={firstInnerRowLabelTop(editable)}
          >
            <GreyContainer>
              <Flex direction="column" gap="3">
                <InnerRow label="Decision Criteria">
                  {editable ? (
                    <Select
                      value={selectedCriteria.id}
                      setValue={(decisionCriteriaId) =>
                        update({ decisionCriteriaId })
                      }
                      style={{ width: CONTROLS_PX }}
                      // The menu shows each criteria's description under its
                      // name (set in review); the closed field shows just the
                      // name.
                      valueLabel={selectedCriteria.name}
                      contentClassName={clsx(
                        planStyles.describedMenu,
                        criteriaTwoLine && planStyles.describedMenuTwoLine,
                      )}
                    >
                      {criteriaOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div>{c.name}</div>
                          {c.description ? (
                            <div
                              ref={measureDescription}
                              className={planStyles.optionDescription}
                              title={c.description}
                            >
                              {c.description}
                            </div>
                          ) : (
                            // Empty state, a step lighter (set in review).
                            <div
                              className={clsx(
                                planStyles.optionDescription,
                                planStyles.optionDescriptionEmpty,
                              )}
                            >
                              No description
                            </div>
                          )}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <Text>{selectedCriteria.name}</Text>
                  )}
                  {/* Opens the rules in a popover (set in review), not the
                    read-only Decision Criteria modal. */}
                  <DecisionRulesPopover criteria={selectedCriteria} />
                </InnerRow>
                {/* STUBBED: no product field for either outcome below. Local
                  draft only; never saved. */}
                <InnerRow
                  label="At End"
                  info="What happens when the experiment reaches its end."
                >
                  {editable ? (
                    <Select
                      value={draft.atEnd}
                      setValue={(v) =>
                        update({ atEnd: v as SetupDraft["atEnd"] })
                      }
                      style={{ width: CONTROLS_PX }}
                    >
                      <SelectItem value="notify">
                        {AT_END_LABELS.notify}
                      </SelectItem>
                      <SelectItem value="ship-winner">
                        {AT_END_LABELS["ship-winner"]}
                      </SelectItem>
                    </Select>
                  ) : (
                    <Text>{AT_END_LABELS[draft.atEnd]}</Text>
                  )}
                </InnerRow>
                {/* Only meaningful when the end action ships something; with
                  "notify only" there's no winner to fall back from. */}
                {draft.atEnd === "ship-winner" ? (
                  <InnerRow
                    label="If no clear winner"
                    info="What ships when no variation clearly wins."
                  >
                    {editable ? (
                      <>
                        <Select
                          value={draft.noClearWinner}
                          setValue={(v) =>
                            update({
                              noClearWinner: v as SetupDraft["noClearWinner"],
                            })
                          }
                          style={{
                            width:
                              draft.noClearWinner === "ship-variation"
                                ? NO_WINNER_PX
                                : CONTROLS_PX,
                          }}
                        >
                          <SelectItem value="keep-running">
                            {NO_WINNER_LABELS["keep-running"]}
                          </SelectItem>
                          <SelectItem value="ship-variation">
                            {NO_WINNER_LABELS["ship-variation"]}
                          </SelectItem>
                        </Select>
                        {draft.noClearWinner === "ship-variation" ? (
                          <Select
                            value={
                              draft.noClearWinnerVariationId ??
                              variations[0]?.id
                            }
                            setValue={(noClearWinnerVariationId) =>
                              update({ noClearWinnerVariationId })
                            }
                            style={{
                              width:
                                CONTROLS_PX - CONTROL_GAP_PX - NO_WINNER_PX,
                            }}
                          >
                            {variations.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.name}
                              </SelectItem>
                            ))}
                          </Select>
                        ) : null}
                      </>
                    ) : (
                      <Text>
                        {NO_WINNER_LABELS[draft.noClearWinner]}
                        {draft.noClearWinner === "ship-variation"
                          ? `: ${
                              variations.find(
                                (v) =>
                                  v.id ===
                                  (draft.noClearWinnerVariationId ??
                                    variations[0]?.id),
                              )?.name ?? ""
                            }`
                          : ""}
                      </Text>
                    )}
                  </InnerRow>
                ) : null}
              </Flex>
            </GreyContainer>
          </Row>
        ) : null}
      </Flex>

      {/* The design leaves Advanced's contents unspecified. For now it holds
        every analysis setting that isn't the data source: the stats settings
        (engine, CUPED, post-stratification, sequential testing), then the
        rest (activation metric, slices, dimensions, segment, conversion and
        analysis windows, SQL filter, metric overrides). The data source and
        assignment query are in the rail's Edit Data Source modal. */}
      {/* 80px of extra room below, so there's space to scroll past the end
        of the page (set in review). */}
      {/* Four sibling groups in place of the single Advanced section (set
        in review), each opening on its own, all closed to start. One level
        of disclosure: nothing inside them collapses. Every field is as it
        was under Advanced, only sorted into groups. */}
      {/* Advanced is one disclosure again (set in review); inside it, the four settings sections, each in its own
        card rather than an accordion. 80px of extra room below, so there's
        space to scroll past the end of the page. */}
      {/* A divider above Advanced, 32px below the Decision box, in
        --gray-a3, two steps lighter than the page's section dividers;
        Advanced sits 24px below it (both restored and set in review). */}
      <Box
        mt="6"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
        aria-hidden
      />
      <Box mt="5" style={{ paddingBottom: 80 }}>
        {/* The whole row opens and closes it: "Advanced" at weight 500 in
          the page text colour, and the rail's Data chevron (--slate-9, 12px,
          right when closed and turning down when open). */}
        <button
          type="button"
          className={planStyles.disclosureRow}
          onClick={() => setAdvancedOpen(!advancedOpen)}
          aria-expanded={advancedOpen}
          aria-controls="setup-advanced-analysis"
        >
          <PiCaretRight
            size="12"
            className={planStyles.disclosureCaret}
            data-open={advancedOpen ? "true" : "false"}
            aria-hidden
          />
          <Text weight="medium">Advanced</Text>
        </button>
        {/* Hidden, not unmounted, when closed: the fields hold unsaved edits
          that the page's Save still has to commit. Opens and closes with a
          smooth height change (set in review; see Collapse). The 16px below
          the row, the same as between the cards (set in review), is inside
          the part that animates, so closed takes no room. */}
        <Collapse open={advancedOpen} id="setup-advanced-analysis">
          <Box pt="4">
            <AdvancedAnalysisFields
              experiment={experiment}
              goalMetrics={draft.goalMetrics}
              secondaryMetrics={draft.secondaryMetrics}
              guardrailMetrics={draft.guardrailMetrics}
              editable={canEditAnalysisSettings}
              onStateChange={onAdvancedStateChange}
              renderGroups={({
                who,
                counting,
                overrides,
                hasCounting,
                hasOverrides,
              }) => (
                <Flex direction="column" gap="4">
                  <SettingsCard title="Statistics">
                    <StatsSettingsFields
                      experiment={experiment}
                      draft={draft}
                      update={update}
                      editable={canEditAnalysisSettings}
                    />
                  </SettingsCard>
                  <SettingsCard title="Exposures">{who}</SettingsCard>
                  {/* Measurement and Metric Overrides only once there's something
                  to configure (set in review): no empty cards before a data source
                  or metrics are set. */}
                  {hasCounting ? (
                    <SettingsCard title="Measurement">{counting}</SettingsCard>
                  ) : null}
                  {hasOverrides ? (
                    <SettingsCard title="Metric Overrides">
                      {overrides}
                    </SettingsCard>
                  ) : null}
                </Flex>
              )}
            />
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
}
