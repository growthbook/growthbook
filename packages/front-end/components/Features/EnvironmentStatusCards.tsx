import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { FeatureValueType } from "shared/types/feature";
import { PiArrowRight, PiCaretDown, PiCaretUp, PiMinus } from "react-icons/pi";
import {
  EnvironmentReason,
  EnvironmentStatus,
  EnvironmentValue,
  PrerequisiteResult,
  StepStatus,
} from "@/services/environmentStatus";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import { Popover } from "@/ui/Popover";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import ScrollArea, { pinnedTo } from "@/ui/ScrollArea";
import Text from "@/ui/Text";
import ValueDisplay, { BooleanDot } from "./ValueDisplay";
import StateIcon from "./StateIcon";
import { featureStatusColors } from "./FeaturesOverview";
import styles from "./EnvironmentStatusCards.module.scss";

export type EnvironmentCard = {
  id: string;
  // Null until the prerequisites' states load.
  status: EnvironmentStatus | null;
  prerequisites: {
    id: string;
    index: number;
    result: PrerequisiteResult | null;
  }[];
  // The viewed draft turns the environment on or off.
  environmentChanged: boolean;
  // The rules it evaluates: those not inactive or skipped.
  ruleCount: number;
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

// JSON on one line, spaced like it reads aloud: {"a": 1, "b": [2]}.
function oneLineJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 1)
      .replace(/([[{])\n\s*/g, "$1")
      .replace(/\n\s*([\]}])/g, "$1")
      .replace(/\n\s*/g, " ");
  } catch {
    return value.replace(/\s+/g, " ");
  }
}

// A value as the SDK hands it back; an environment serving nothing is null.
function displayValue(value: string | null, valueType: FeatureValueType) {
  if (value === null) return "null";
  if (valueType === "string") return JSON.stringify(value);
  if (valueType === "json") return oneLineJson(value);
  return value;
}

function ValueText({
  value,
  valueType,
  muted = false,
  withPercent = true,
}: {
  value: EnvironmentValue;
  valueType: FeatureValueType;
  muted?: boolean;
  // Off when the caller places the share itself.
  withPercent?: boolean;
}) {
  if (value.kind === "varies" || value.kind === "split") {
    return (
      <>
        {/* Some get true and some false. */}
        {valueType === "boolean" ? <BooleanDot fill="split" /> : null}
        <Text color="text-mid" fontStyle="italic" whiteSpace="nowrap">
          {value.kind === "split"
            ? `Split ${value.count} ways`
            : "Varies by user"}
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
      <code
        className={styles.value}
        style={{
          color:
            muted || value.value === null
              ? "var(--color-text-low)"
              : "var(--color-text-high)",
        }}
      >
        {displayValue(value.value, valueType)}
      </code>
    );
  return (
    <>
      {shown}
      {withPercent ? <Percent value={value} /> : null}
    </>
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

// A long value takes the line; its share and reason drop below it, to the
// right.
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
        <BooleanDot fill={servedDot(status)} />
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
          <span className={styles.reason}>
            <Text size="sm" color="text-low" truncate>
              · {reasonText(status.reason)}
            </Text>
          </span>
        </span>
      </span>
    </span>
  );
}

// Whether a non-boolean environment serves a value: to everyone (filled),
// maybe not to all when a prerequisite varies by user (half), or not at all,
// null (empty).
function servedDot(status: EnvironmentStatus): "on" | "split" | "empty" {
  const { value } = status;
  // A JSON null serves nothing too.
  if (value.kind === "value") {
    return value.value === null || value.value === "null" ? "empty" : "on";
  }
  if (value.kind === "varies" && status.prerequisites === "varies") {
    return "split";
  }
  return "on";
}

// The "why" beside a card's value.
function reasonText(reason: EnvironmentReason): string {
  switch (reason.kind) {
    case "disabled":
      return "Environment OFF";
    case "prerequisite":
      return reason.result === "cycle"
        ? "Circular dependency"
        : reason.count > 1
          ? "Prerequisites not met"
          : "Prerequisite not met";
    case "traffic":
      return reason.labels.join(" + ");
    case "default":
      return "Default value";
  }
}

// The prerequisites together: the first that keeps everyone out, else whether
// any depends on who the user is.
function prerequisitesSummary(
  card: EnvironmentCard,
  overall: StepStatus,
): string {
  if (overall === "skipped") return "Not reached";
  const results = card.prerequisites.map((p) => p.result);
  if (results.includes("cycle")) return "Circular dependency";
  if (results.includes("unmet")) return "Not met";
  if (results.includes("varies")) return "Varies by user";
  return card.prerequisites.length > 1 ? "All met" : "Met";
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
  status,
  label,
  children,
}: {
  status: StepStatus;
  label: string;
  children: ReactNode;
}) {
  const muted = status === "none" || status === "skipped";
  return (
    <div className={styles.row}>
      <span className={styles.icon}>
        <StepIcon status={status} />
      </span>
      <span className={styles.label}>
        <Text color={muted ? "text-low" : "text-high"}>{label}</Text>
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

// The holdout or rules a card's traffic passes through, with what each serves.
function Steps({
  status,
  kind,
  valueType,
}: {
  status: EnvironmentStatus;
  kind: "holdout" | "rule";
  valueType: FeatureValueType;
}) {
  const own = kind === "holdout" ? status.holdout : status.rules;
  if (own === "none") return <Text color="text-low">None</Text>;
  if (own === "skipped") return <Text color="text-low">Not reached</Text>;
  return (
    <Flex direction="column" minWidth="0">
      {status.steps
        .filter(({ step }) => step.kind === kind)
        .map(({ step, value }, i) => (
          <Flex
            key={i}
            align="center"
            gap="2"
            minWidth="0"
            className={styles.stepLine}
          >
            <span className={styles.stepTitle}>
              {step.label}
              {step.name ? (
                <>
                  {" "}
                  {step.href ? (
                    <Link href={step.href} className={styles.clamped}>
                      {step.name}
                    </Link>
                  ) : (
                    <span className={styles.clamped}>{step.name}</span>
                  )}
                </>
              ) : null}
              :
            </span>
            <ValueText value={value} valueType={valueType} />
          </Flex>
        ))}
    </Flex>
  );
}

function Drilldown({
  card,
  status,
  valueType,
  defaultValue,
  toggle,
  prerequisiteState,
}: {
  card: EnvironmentCard;
  status: EnvironmentStatus;
  valueType: FeatureValueType;
  defaultValue: string;
  toggle: ReactNode;
  // A prerequisite's state in an environment, with why on hover; a scroll
  // area's clips its tooltip unless it renders at the page root.
  prerequisiteState: (
    prerequisiteId: string,
    environment: string,
    inScrollArea?: boolean,
  ) => ReactNode;
}) {
  const muted = (step: StepStatus) => step === "none" || step === "skipped";
  return (
    <div className={styles.rows}>
      <Row status={status.environment} label="Environment">
        {toggle}
      </Row>
      {card.prerequisites.length ? (
        <Row
          status={status.prerequisites}
          label={`Prerequisites (${card.prerequisites.length})`}
        >
          <Text
            color={muted(status.prerequisites) ? "text-low" : "text-mid"}
            truncate
          >
            {prerequisitesSummary(card, status.prerequisites)}
          </Text>
        </Row>
      ) : null}
      {card.prerequisites.map((p) => (
        <div key={p.index} className={styles.subRow}>
          {prerequisiteState(p.id, card.id)}
          <Link href={`/features/${p.id}`} className={styles.clamped}>
            {p.id}
          </Link>
        </div>
      ))}
      {status.holdout !== "none" ? (
        <Row status={status.holdout} label="Holdout">
          <Steps status={status} kind="holdout" valueType={valueType} />
        </Row>
      ) : null}
      <Row
        status={status.rules}
        label={card.ruleCount ? `Rules (${card.ruleCount})` : "Rules"}
      >
        <Steps status={status} kind="rule" valueType={valueType} />
      </Row>
      <Row status={status.defaultValue} label="Default value">
        <Flex align="baseline" gap="2" minWidth="0">
          <ValueText
            value={{ kind: "value", value: defaultValue }}
            valueType={valueType}
            muted={muted(status.defaultValue)}
          />
        </Flex>
      </Row>
    </div>
  );
}

function Card({
  card,
  valueType,
  defaultValue,
  toggle,
  prerequisiteState,
}: {
  card: EnvironmentCard;
  valueType: FeatureValueType;
  defaultValue: string;
  toggle: ReactNode;
  // A prerequisite's state in an environment, with why on hover; a scroll
  // area's clips its tooltip unless it renders at the page root.
  prerequisiteState: (
    prerequisiteId: string,
    environment: string,
    inScrollArea?: boolean,
  ) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { status } = card;
  const Caret = open ? PiCaretUp : PiCaretDown;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      sideOffset={5}
      showArrow={false}
      trigger={
        <button
          type="button"
          className={styles.card}
          aria-label={`${card.id} status`}
        >
          <Flex align="center" justify="between" gap="2">
            <Text weight="semibold" color="text-mid" truncate>
              {/* The draft turns it on or off. */}
              <span className={clsx(card.environmentChanged && styles.changed)}>
                {card.id}
              </span>
            </Text>
            <Caret size={14} color="var(--gray-9)" />
          </Flex>
          {!status ? (
            <span className={styles.line}>
              <Text color="text-low">…</Text>
            </span>
          ) : valueType === "json" || valueType === "string" ? (
            <WrappingValueLine status={status} valueType={valueType} />
          ) : (
            <span className={styles.line}>
              {valueType === "boolean" ? null : (
                <BooleanDot fill={servedDot(status)} />
              )}
              <ValueText value={status.value} valueType={valueType} />
              <span className={styles.reason}>
                <Text size="sm" color="text-low" truncate>
                  · {reasonText(status.reason)}
                </Text>
              </span>
            </span>
          )}
        </button>
      }
      content={
        status ? (
          <Drilldown
            card={card}
            status={status}
            valueType={valueType}
            defaultValue={defaultValue}
            toggle={toggle}
            prerequisiteState={prerequisiteState}
          />
        ) : (
          <Text color="text-low">Loading…</Text>
        )
      }
    />
  );
}

// Each environment as what it serves, and why. Its drilldown walks the
// evaluation and holds the environment's controls.
export default function EnvironmentStatusCards({
  cards,
  valueType,
  defaultValue,
  renderToggle,
  prerequisiteState,
}: {
  cards: EnvironmentCard[];
  valueType: FeatureValueType;
  defaultValue: string;
  renderToggle: (environment: string) => ReactNode;
  // A prerequisite's state in an environment, with why on hover; a scroll
  // area's clips its tooltip unless it renders at the page root.
  prerequisiteState: (
    prerequisiteId: string,
    environment: string,
    inScrollArea?: boolean,
  ) => ReactNode;
}) {
  return (
    <div
      className={clsx(
        styles.grid,
        (valueType === "json" || valueType === "string") && styles.wide,
      )}
    >
      {cards.map((card) => (
        <Card
          key={card.id}
          card={card}
          valueType={valueType}
          defaultValue={defaultValue}
          toggle={renderToggle(card.id)}
          prerequisiteState={prerequisiteState}
        />
      ))}
    </div>
  );
}

const CHANGE_LABELS = {
  added: "Added",
  edited: "Edited",
  removed: "Removed",
} as const;

function ChangeBadge({ change }: { change: keyof typeof CHANGE_LABELS }) {
  return (
    <Badge
      size="xs"
      color="amber"
      variant="soft"
      label={CHANGE_LABELS[change]}
    />
  );
}

// Wide enough for an environment's name and its status, before they truncate.
const ENVIRONMENT_COLUMN_WIDTH = 96;
// Room for an id, its draft badge and its menu.
const NAME_COLUMN_WIDTH = 260;

// The feature's prerequisites, where they're edited. Shut until asked for.
export function PrerequisiteList({
  prerequisites,
  removed,
  environments,
  actions,
  add,
  prerequisiteState,
}: {
  prerequisites: {
    id: string;
    index: number;
    change: "added" | "edited" | null;
  }[];
  // Live prerequisites the viewed draft removes.
  removed: string[];
  environments: string[];
  actions: (index: number) => ReactNode;
  // Adds another, as the table's last row.
  add: ReactNode;
  // A prerequisite's state in an environment, with why on hover; a scroll
  // area's clips its tooltip unless it renders at the page root.
  prerequisiteState: (
    prerequisiteId: string,
    environment: string,
    inScrollArea?: boolean,
  ) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const name = (content: ReactNode) => (
    <TableCell className={clsx(styles.pinned, pinnedTo.left)}>
      <Flex align="center" gap="2" minWidth="0">
        {content}
      </Flex>
    </TableCell>
  );
  return (
    <Box mt="5">
      <CollapseTrigger open={open} onOpenChange={setOpen}>
        <Flex align="center" gap="2">
          <Text weight="medium" color="text-mid">
            {/* The draft adds, edits or removes one. */}
            <span
              className={clsx(
                (removed.length > 0 || prerequisites.some((p) => p.change)) &&
                  styles.changed,
              )}
            >
              Prerequisites
            </span>
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
        <ScrollArea
          direction="horizontal"
          wheelScrollsSideways
          // The pinned names shadow what scrolls under them; the far end fades.
          edgeCue="fade"
          skipEdges={["left"]}
          className={styles.prerequisiteScroll}
        >
          <div
            style={{
              minWidth:
                NAME_COLUMN_WIDTH +
                environments.length * ENVIRONMENT_COLUMN_WIDTH,
            }}
          >
            <Table
              variant="ghost"
              size="sm"
              className={styles.prerequisiteTable}
            >
              <TableHeader>
                <TableRow>
                  <TableColumnHeader
                    className={clsx(styles.pinned, pinnedTo.left)}
                    style={{ width: NAME_COLUMN_WIDTH }}
                  >
                    Feature
                  </TableColumnHeader>
                  {environments.map((env) => (
                    <TableColumnHeader
                      key={env}
                      justify="center"
                      style={{ width: ENVIRONMENT_COLUMN_WIDTH }}
                    >
                      <Text truncate>{env}</Text>
                    </TableColumnHeader>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {prerequisites.map((p) => (
                  <TableRow key={p.index}>
                    {name(
                      <>
                        <Link
                          href={`/features/${p.id}`}
                          className={styles.prerequisiteName}
                        >
                          {p.id}
                        </Link>
                        {p.change ? <ChangeBadge change={p.change} /> : null}
                        <span className={styles.actions}>
                          {actions(p.index)}
                        </span>
                      </>,
                    )}
                    {environments.map((env) => (
                      <TableCell key={env} justify="center">
                        <Flex justify="center">
                          {prerequisiteState(p.id, env, true)}
                        </Flex>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {removed.map((id) => (
                  <TableRow key={id}>
                    {name(
                      <>
                        <Text color="text-low" truncate>
                          {id}
                        </Text>
                        <ChangeBadge change="removed" />
                      </>,
                    )}
                    {environments.map((env) => (
                      <TableCell key={env} />
                    ))}
                  </TableRow>
                ))}
                {add ? (
                  <TableRow>
                    {name(add)}
                    <TableCell colSpan={environments.length} />
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      </Collapse>
    </Box>
  );
}
