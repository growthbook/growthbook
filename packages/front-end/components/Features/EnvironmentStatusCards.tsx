import { Fragment, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureValueType } from "shared/types/feature";
import {
  PiArrowRight,
  PiCaretDown,
  PiCaretUp,
  PiMinus,
  PiPlus,
} from "react-icons/pi";
import {
  displayValue,
  EnvironmentStatus,
  EnvironmentValue,
  PrerequisiteResult,
  prerequisitesSummary,
  reasonText,
  servedDot,
  StepStatus,
  stepServes,
  stepTargets,
  TrafficStep,
} from "@/services/environmentStatus";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import { Popover } from "@/ui/Popover";
import ScrollArea from "@/ui/ScrollArea";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";
import ValueDisplay, { BooleanDot } from "./ValueDisplay";
import StateIcon from "./StateIcon";
import PrerequisiteTable from "./PrerequisiteTable";
import DraftChangesPopover, {
  DraftChangeMark,
  DraftChangeSection,
  mergeDraftChangeSections,
} from "./DraftChangesPopover";
import { featureStatusColors } from "./FeaturesOverview";
import styles from "./EnvironmentStatusCards.module.scss";

// A prerequisite's state in an environment, with why on hover; a scroll area's
// clips its tooltip unless it renders at the page root. Inline, it's sized to
// sit beside text.
type PrerequisiteStateRenderer = (
  prerequisiteId: string,
  environment: string,
  options?: { inScrollArea?: boolean; inline?: boolean },
) => ReactNode;

// Brings an environment's rule into view in the rule list.
type RuleJumper = (environment: string, ruleId: string) => void;

export type EnvironmentCard = {
  id: string;
  // Null until the prerequisites' states load.
  status: EnvironmentStatus | null;
  prerequisites: {
    id: string;
    index: number;
    result: PrerequisiteResult | null;
  }[];
  // What the draft changes about this environment's switch, if anything.
  environmentChanges: DraftChangeSection[] | null;
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function ValueText({
  value,
  valueType,
  muted = false,
  withPercent = true,
  revealable = false,
}: {
  value: EnvironmentValue;
  valueType: FeatureValueType;
  muted?: boolean;
  // Off when the caller places the share itself.
  withPercent?: boolean;
  // Cut short, its whole value shows on hover or focus.
  revealable?: boolean;
}) {
  if (value.kind === "none") {
    return (
      <Text color="text-low" whiteSpace="nowrap">
        Reaches no one
      </Text>
    );
  }
  if (value.kind === "varies") {
    return (
      <>
        {/* Some get true and some false. */}
        {valueType === "boolean" ? <BooleanDot fill="split" /> : null}
        <Text color="text-mid" fontStyle="italic" whiteSpace="nowrap">
          Varies by user
        </Text>
      </>
    );
  }
  const shown =
    valueType === "boolean" ? (
      <span
        className={styles.value}
        style={muted ? { opacity: 0.6 } : undefined}
      >
        {/* Serving nothing, a boolean flag reads as false. */}
        <ValueDisplay
          value={value.value ?? "false"}
          type="boolean"
          split={value.kind === "partial"}
        />
      </span>
    ) : (
      <ValueCode
        text={displayValue(value.value, valueType)}
        muted={muted || value.value === null}
        revealable={revealable}
      />
    );
  return (
    <>
      {shown}
      {withPercent ? <Percent value={value} /> : null}
    </>
  );
}

function ClampedLink({
  name,
  href,
  className,
}: {
  name: string;
  href: string;
  className: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const truncated = useIsOverflowingX(ref);
  return (
    <Tooltip content={name} enabled={truncated}>
      <Link ref={ref} href={href} className={className}>
        {name}
      </Link>
    </Tooltip>
  );
}

function ValueCode({
  text,
  muted,
  revealable = false,
}: {
  text: string;
  muted: boolean;
  revealable?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const truncated = useIsOverflowingX(ref, revealable, text);
  return (
    <Tooltip content={text} enabled={revealable && truncated}>
      <code
        ref={ref}
        className={styles.value}
        tabIndex={revealable && truncated ? 0 : undefined}
        style={{
          color: muted ? "var(--color-text-low)" : "var(--color-text-high)",
        }}
      >
        {text}
      </code>
    </Tooltip>
  );
}

function ReasonText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const truncated = useIsOverflowingX(ref);
  // The span triggers it: @/ui/Text drops the hover handlers a trigger needs.
  return (
    <Tooltip content={text} enabled={truncated}>
      <span className={styles.reason}>
        <Text ref={ref} size="sm" color="text-mid" truncate>
          {text}
        </Text>
      </span>
    </Tooltip>
  );
}

// The share a partial value reaches, when it's known.
function Percent({ value }: { value: EnvironmentValue }) {
  if (value.kind !== "partial" || value.percent === null) return null;
  return (
    <Text color="text-mid" whiteSpace="nowrap">
      for {percentFormatter.format(value.percent)}
    </Text>
  );
}

// A long value takes the line; its share drops below it, to the right.
function WrappingValueLine({
  status,
  valueType,
}: {
  status: EnvironmentStatus;
  valueType: FeatureValueType;
}) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    const value = valueRef.current;
    const tail = tailRef.current;
    if (!value || !tail) return;
    // On the same line, baseline alignment still sets them a few px apart.
    const measure = () =>
      setWrapped(tail.offsetTop >= value.offsetTop + value.offsetHeight / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(value.parentElement ?? value);
    return () => observer.disconnect();
  }, []);
  return (
    <span className={styles.wrappingLine}>
      <span className={styles.dotSlot}>
        <BooleanDot fill={servedDot(status, valueType)} />
      </span>
      <span className={styles.wrapping} data-wrapped={wrapped || undefined}>
        <span ref={valueRef} className={styles.wrappingValue}>
          <ValueText
            value={status.value}
            valueType={valueType}
            withPercent={false}
          />
        </span>
        <span ref={tailRef} className={styles.line}>
          <Percent value={status.value} />
        </span>
      </span>
    </span>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "on":
    case "met":
      return <StateIcon state="on" />;
    case "off":
      return <StateIcon state="off" />;
    case "unmet":
      return <StateIcon state="off" color={featureStatusColors.danger} />;
    case "varies":
      return <StateIcon state="varies" />;
    case "applies":
      return <PiArrowRight size={15} color="var(--color-text-high)" />;
    case "none":
    case "skipped":
      return <PiMinus size={15} color="var(--gray-8)" />;
  }
}

function Row({
  icon,
  label,
  muted = false,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>
        <Text color={muted ? "text-low" : "text-high"} whiteSpace="nowrap">
          {label}
        </Text>
      </span>
      <Flex
        align="center"
        gap="2"
        minWidth="0"
        pl="3"
        style={{ minHeight: 28 }}
      >
        {children}
      </Flex>
    </div>
  );
}

// A group of rows, with what they come to together when there's an icon for
// it, in line with the rows' icons.
function Section({
  label,
  icon,
  muted = false,
}: {
  label: string;
  icon?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={styles.section}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <Text weight="medium" color={muted ? "text-low" : "text-mid"}>
        {label}
      </Text>
    </div>
  );
}

// Labeled lines beside a row's label: what it serves, and to whom.
function Fields({ fields }: { fields: { label: string; value: ReactNode }[] }) {
  return (
    <span className={`${styles.fields} ${styles.stepFields}`}>
      {fields.map(({ label, value }) => (
        <Fragment key={label}>
          <Text color="text-low">{label}:</Text>
          <span className={styles.line}>{value}</span>
        </Fragment>
      ))}
    </span>
  );
}

// What a rule or rules serve whoever they reach, and who that is.
function StepFields({
  step,
  valueType,
}: {
  step: TrafficStep;
  valueType: FeatureValueType;
}) {
  const serves = stepServes(step, valueType === "boolean");
  const targets = stepTargets(step);
  return (
    <Fields
      fields={[
        ...(serves
          ? [
              {
                label: "Serves",
                // Split across an experiment's arms, its values say less than
                // how many there are.
                value:
                  serves.kind === "varies" &&
                  valueType !== "boolean" &&
                  step.variations ? (
                    <Text color="text-mid">{step.variations} variations</Text>
                  ) : (
                    <ValueText
                      value={serves}
                      valueType={valueType}
                      revealable
                    />
                  ),
              },
            ]
          : []),
        ...(targets
          ? [
              {
                label: "Targets",
                value: <Text color="text-mid">{targets}</Text>,
              },
            ]
          : []),
      ]}
    />
  );
}

// A rule, which takes you to it in the rule list.
function RuleRow({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <Row
      icon={null}
      label={
        onClick ? (
          <Link color="dark" underline="hover" onClick={onClick}>
            {label}
          </Link>
        ) : (
          label
        )
      }
    >
      {children}
    </Row>
  );
}

function Drilldown({
  card,
  status,
  valueType,
  toggle,
  prerequisiteState,
  jumpToRule,
}: {
  card: EnvironmentCard;
  status: EnvironmentStatus;
  valueType: FeatureValueType;
  toggle: ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
  jumpToRule: (ruleId: string) => void;
}) {
  const holdout = status.steps.find(({ step }) => step.kind === "holdout");
  // Only rules that bear on the outcome: not one that reaches no one, which
  // the SDK drops, nor one no traffic gets as far as.
  const rules = status.steps.flatMap(({ step, reachable }) =>
    step.kind === "rule" && reachable && step.traffic?.participation !== 0
      ? [step]
      : [],
  );
  // The first rule, or the first two when they settle everyone between them;
  // the rest together.
  const [expanded, setExpanded] = useState(false);
  const shown =
    expanded || (rules.length === 2 && status.defaultValue === "skipped")
      ? rules
      : rules.slice(0, 1);
  const rest = rules.slice(shown.length);
  return (
    <div className={styles.rows}>
      <Row icon={<StepIcon status={status.environment} />} label="Environment">
        {toggle}
        {/* Not sent at all, whatever its switch says; the switch is what
            serves once it's unarchived. */}
        {status.reason.kind === "archived" ? (
          <Text color="text-low" whiteSpace="nowrap">
            Archived, not sent to SDKs
          </Text>
        ) : null}
      </Row>
      {card.prerequisites.length ? (
        <>
          <Section
            label="Prerequisites"
            icon={<StepIcon status={status.prerequisites} />}
            muted={status.prerequisites === "skipped"}
          />
          <div className={styles.group}>
            {card.prerequisites.map((p) => {
              const muted = status.prerequisites === "skipped";
              return (
                <Row
                  key={p.index}
                  icon={null}
                  muted={muted}
                  label={
                    <ClampedLink
                      name={p.id}
                      href={`/features/${p.id}`}
                      className={styles.clamped}
                    />
                  }
                >
                  <Flex align="center" style={{ gap: 6 }}>
                    {muted
                      ? null
                      : prerequisiteState(p.id, card.id, { inline: true })}
                    <Text color={muted ? "text-low" : "text-mid"}>
                      {prerequisitesSummary([p.result], status.prerequisites)}
                    </Text>
                  </Flex>
                </Row>
              );
            })}
          </div>
        </>
      ) : null}
      {status.holdout !== "none" ? (
        <Row
          icon={<StepIcon status={holdout ? "applies" : "skipped"} />}
          muted={!holdout}
          label="Holdout"
        >
          {holdout ? (
            <StepFields step={holdout.step} valueType={valueType} />
          ) : (
            <Text color="text-low">Not reachable</Text>
          )}
        </Row>
      ) : null}
      {rules.length ? (
        <>
          <Section icon={<StepIcon status="applies" />} label="Rules reached" />
          <div className={styles.group}>
            {shown.map((step, i) => {
              const { ruleId } = step;
              return (
                <RuleRow
                  key={i}
                  label={step.label}
                  onClick={ruleId !== null ? () => jumpToRule(ruleId) : null}
                >
                  <StepFields step={step} valueType={valueType} />
                </RuleRow>
              );
            })}
            {rest.length ? (
              <Row
                icon={null}
                label={
                  <Link underline="hover" onClick={() => setExpanded(true)}>
                    {/* Inline, so the underline runs under the text. */}
                    <PiPlus
                      size={12}
                      style={{ marginRight: 4, verticalAlign: -1 }}
                    />
                    {rest.length} other {rest.length === 1 ? "rule" : "rules"}
                  </Link>
                }
              >
                {null}
              </Row>
            ) : null}
          </div>
        </>
      ) : (
        <Row icon={<StepIcon status="skipped" />} muted label="Rules">
          {/* Hidden from the list above, rules that reach no one still exist. */}
          <Text color="text-low">
            {status.rules === "skipped"
              ? "Not reachable"
              : status.rules === "none"
                ? "None"
                : "None reach anyone"}
          </Text>
        </Row>
      )}
      <Row
        icon={<StepIcon status={status.defaultValue} />}
        muted={status.defaultValue === "skipped"}
        label="Default value"
      >
        {status.defaultValue === "skipped" ? (
          <Text color="text-low">Not reachable</Text>
        ) : (
          <Fields
            fields={[
              {
                label: "Serves",
                value: (
                  <ValueText
                    value={{ kind: "value", value: status.servedDefault }}
                    valueType={valueType}
                    revealable
                  />
                ),
              },
            ]}
          />
        )}
      </Row>
    </div>
  );
}

function Card({
  card,
  valueType,
  toggle,
  prerequisiteState,
  jumpToRule,
  side = "bottom",
}: {
  card: EnvironmentCard;
  valueType: FeatureValueType;
  toggle: ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
  jumpToRule: RuleJumper;
  side?: "bottom" | "right";
}) {
  const [open, setOpen] = useState(false);
  // Closed to go to a rule, focus follows it there, not back to the card.
  const jumping = useRef(false);
  const { status } = card;
  const reason = status ? reasonText(status.reason) : null;
  const Caret = open ? PiCaretUp : PiCaretDown;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onCloseAutoFocus={(e) => {
        if (!jumping.current) return;
        jumping.current = false;
        e.preventDefault();
      }}
      side={side}
      align="start"
      sideOffset={5}
      showArrow={false}
      trigger={
        <button type="button" className={styles.card}>
          <Flex align="center" justify="between" gap="2">
            <Text weight="semibold" color="text-mid" truncate>
              {card.environmentChanges ? (
                <DraftChangesPopover sections={card.environmentChanges}>
                  <span className={styles.changed}>{card.id}</span>
                </DraftChangesPopover>
              ) : (
                card.id
              )}
            </Text>
            <Caret size={14} color="var(--gray-9)" />
          </Flex>
          <span className={styles.fields}>
            <Text size="sm" color="text-low">
              Serves:
            </Text>
            {!status ? (
              <span className={styles.line}>
                <Text color="text-low">…</Text>
              </span>
            ) : valueType === "json" ? (
              <WrappingValueLine status={status} valueType={valueType} />
            ) : (
              <span className={styles.line}>
                {valueType === "boolean" ? null : (
                  <BooleanDot fill={servedDot(status, valueType)} />
                )}
                <ValueText value={status.value} valueType={valueType} />
              </span>
            )}
            {reason !== null ? (
              <>
                <Text size="sm" color="text-low">
                  Reason:
                </Text>
                <ReasonText text={reason} />
              </>
            ) : null}
          </span>
        </button>
      }
      content={
        status ? (
          <Drilldown
            card={card}
            status={status}
            valueType={valueType}
            toggle={toggle}
            prerequisiteState={prerequisiteState}
            // Out of the way of the rule it takes you to.
            jumpToRule={(ruleId) => {
              jumping.current = true;
              setOpen(false);
              jumpToRule(card.id, ruleId);
            }}
          />
        ) : (
          // The switch stays in reach while what it serves isn't known.
          <div className={styles.rows}>
            <Row icon={null} label="Environment">
              {toggle}
            </Row>
            <span className={styles.subRow}>
              <Text color="text-low">What it serves isn&apos;t known yet.</Text>
            </span>
          </div>
        )
      }
    />
  );
}

// The environments that don't fit, as the same cards in a list. What the
// draft changes about any of them shows here too.
function MoreCards({
  cards,
  valueType,
  renderToggle,
  prerequisiteState,
  jumpToRule,
}: {
  cards: EnvironmentCard[];
  valueType: FeatureValueType;
  renderToggle: (environment: string) => ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
  jumpToRule: RuleJumper;
}) {
  const [open, setOpen] = useState(false);
  // Closed to go to a rule, focus follows it there, not back to the card.
  const jumping = useRef(false);
  // Several environments' switches read as one section of them.
  const changes = mergeDraftChangeSections(
    cards.flatMap((card) => card.environmentChanges ?? []),
  ).map((section) =>
    section.title === "Environment" && section.rows.length > 1
      ? { ...section, title: "Environments" }
      : section,
  );
  const label = `More environments (${cards.length})`;
  const Caret = open ? PiCaretUp : PiCaretDown;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onCloseAutoFocus={(e) => {
        if (!jumping.current) return;
        jumping.current = false;
        e.preventDefault();
      }}
      side="bottom"
      align="start"
      sideOffset={5}
      showArrow={false}
      trigger={
        <button type="button" className={styles.card}>
          <Flex align="center" justify="between" gap="2">
            <Text weight="semibold" color="text-mid" truncate>
              {changes.length ? (
                <DraftChangesPopover sections={changes}>
                  <span className={styles.changed}>{label}</span>
                </DraftChangesPopover>
              ) : (
                label
              )}
            </Text>
            <Caret size={14} color="var(--gray-9)" />
          </Flex>
          <Text size="sm" color="text-low" truncate>
            {cards.map((card) => card.id).join(", ")}
          </Text>
        </button>
      }
      // The list holds the padding, so its scrollbar runs at the edge.
      contentStyle={{ padding: 0 }}
      content={
        <ScrollArea style={{ maxHeight: "60vh" }}>
          <div className={styles.moreList}>
            {cards.map((card) => (
              <Card
                key={card.id}
                card={card}
                valueType={valueType}
                toggle={renderToggle(card.id)}
                prerequisiteState={prerequisiteState}
                jumpToRule={(environment, ruleId) => {
                  jumping.current = true;
                  setOpen(false);
                  jumpToRule(environment, ruleId);
                }}
                side="right"
              />
            ))}
          </div>
        </ScrollArea>
      }
    />
  );
}

// Each environment as what it serves, and why. Its drilldown walks the
// evaluation and holds the environment's controls.
export default function EnvironmentStatusCards({
  cards,
  valueType,
  renderToggle,
  prerequisiteState,
  jumpToRule,
}: {
  cards: EnvironmentCard[];
  valueType: FeatureValueType;
  renderToggle: (environment: string) => ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
  jumpToRule: RuleJumper;
}) {
  // How many cards a row holds, as the grid lays them out.
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number | null>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const measure = () =>
      setColumns(
        getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean)
          .length,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);
  // Past one row, the last place goes to the rest, but at least two show,
  // wrapping if they must. One left over shows in that place itself.
  const overflows = columns !== null && cards.length > Math.max(columns, 3);
  const shown = overflows ? Math.max(2, columns - 1) : cards.length;
  return (
    <div ref={ref} className={styles.grid}>
      {cards.slice(0, shown).map((card) => (
        <Card
          key={card.id}
          card={card}
          valueType={valueType}
          toggle={renderToggle(card.id)}
          prerequisiteState={prerequisiteState}
          jumpToRule={jumpToRule}
        />
      ))}
      {shown < cards.length ? (
        <MoreCards
          cards={cards.slice(shown)}
          valueType={valueType}
          renderToggle={renderToggle}
          prerequisiteState={prerequisiteState}
          jumpToRule={jumpToRule}
        />
      ) : null}
    </div>
  );
}

// The feature's prerequisites, where they're edited. Shut until asked for.
export function PrerequisiteList({
  prerequisites,
  removed,
  changes,
  environments,
  actions,
  prerequisiteState,
}: {
  prerequisites: {
    id: string;
    index: number;
    change: "added" | "edited" | null;
  }[];
  // Live prerequisites the viewed draft removes.
  removed: string[];
  // What the draft changes about them, if anything.
  changes: DraftChangeSection[] | null;
  environments: string[];
  actions: (index: number) => ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Box mt="5">
      <CollapseTrigger open={open} onOpenChange={setOpen}>
        <Flex align="center" gap="2">
          <Text weight="medium" color="text-mid">
            {changes ? (
              <DraftChangesPopover sections={changes}>
                <span className={styles.changed}>Prerequisites</span>
              </DraftChangesPopover>
            ) : (
              "Prerequisites"
            )}
          </Text>
          <Badge
            label={String(prerequisites.length)}
            size="xs"
            color="gray"
            variant="soft"
            radius="full"
          />
        </Flex>
      </CollapseTrigger>
      <Collapse open={open} duration={150}>
        <Box mt="2">
          <PrerequisiteTable
            environments={environments}
            rows={[
              ...prerequisites.map((p) => ({
                key: p.index,
                name: (
                  <>
                    <ClampedLink
                      name={p.id}
                      href={`/features/${p.id}`}
                      className={styles.prerequisiteName}
                    />
                    {p.change ? (
                      <DraftChangeMark change={p.change} spelled />
                    ) : null}
                    <span className={styles.actions}>{actions(p.index)}</span>
                  </>
                ),
                state: (env: string) =>
                  prerequisiteState(p.id, env, { inScrollArea: true }),
              })),
              ...removed.map((id) => ({
                key: id,
                name: (
                  <>
                    <Text color="text-low" truncate>
                      {id}
                    </Text>
                    <DraftChangeMark change="removed" spelled />
                  </>
                ),
              })),
            ]}
          />
        </Box>
      </Collapse>
    </Box>
  );
}
