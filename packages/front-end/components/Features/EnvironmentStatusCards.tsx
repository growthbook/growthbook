import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureValueType } from "shared/types/feature";
import { PiArrowRight, PiCaretDown, PiCaretUp, PiMinus } from "react-icons/pi";
import {
  displayValue,
  EnvironmentReason,
  EnvironmentStatus,
  EnvironmentValue,
  PrerequisiteResult,
  prerequisitesSummary,
  reasonText,
  servedDot,
  StepStatus,
} from "@/services/environmentStatus";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import { Popover } from "@/ui/Popover";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import TruncatedText from "@/ui/TruncatedText";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";
import ValueDisplay, { BooleanDot } from "./ValueDisplay";
import StateIcon from "./StateIcon";
import PrerequisiteTable from "./PrerequisiteTable";
import DraftChangesPopover, {
  DraftChangeMark,
  DraftChangeSection,
} from "./DraftChangesPopover";
import { featureStatusColors } from "./FeaturesOverview";
import styles from "./EnvironmentStatusCards.module.scss";

// A prerequisite's state in an environment, with why on hover; a scroll area's
// clips its tooltip unless it renders at the page root.
type PrerequisiteStateRenderer = (
  prerequisiteId: string,
  environment: string,
  inScrollArea?: boolean,
) => ReactNode;

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
  // The rules it evaluates: those not inactive or skipped.
  ruleCount: number;
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
}: {
  value: EnvironmentValue;
  valueType: FeatureValueType;
  muted?: boolean;
  // Off when the caller places the share itself.
  withPercent?: boolean;
}) {
  if (value.kind === "none") {
    return (
      <Text color="text-low" whiteSpace="nowrap">
        Reaches no one
      </Text>
    );
  }
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
      <ValueCode
        text={displayValue(value.value, valueType)}
        muted={muted || value.value === null}
      />
    );
  return (
    <>
      {shown}
      {withPercent ? <Percent value={value} /> : null}
    </>
  );
}

// A linked name cut short to its room, all of it on hover when it is. (Plain
// text has TruncatedText.)
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

// A value cut short to its room, all of it on hover when it is.
function ValueCode({ text, muted }: { text: string; muted: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const truncated = useIsOverflowingX(ref);
  return (
    <Tooltip content={text} enabled={truncated}>
      <code
        ref={ref}
        className={styles.value}
        style={{
          color: muted ? "var(--color-text-low)" : "var(--color-text-high)",
        }}
      >
        {text}
      </code>
    </Tooltip>
  );
}

// Why a card serves what it does, cut short to its room, all of it on hover
// when it is.
function ReasonText({ reason }: { reason: EnvironmentReason }) {
  const ref = useRef<HTMLSpanElement>(null);
  const truncated = useIsOverflowingX(ref);
  const text = reasonText(reason);
  // The span triggers it: @/ui/Text drops the hover handlers a trigger needs.
  return (
    <Tooltip content={text} enabled={truncated}>
      <span className={styles.reason}>
        <Text ref={ref} size="sm" color="text-low" truncate>
          · {text}
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
          <ReasonText reason={status.reason} />
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
                    <ClampedLink
                      name={step.name}
                      href={step.href}
                      className={styles.clamped}
                    />
                  ) : (
                    <TruncatedText text={step.name} maxWidth={160} />
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
  toggle,
  prerequisiteState,
}: {
  card: EnvironmentCard;
  status: EnvironmentStatus;
  valueType: FeatureValueType;
  toggle: ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
}) {
  const muted = (step: StepStatus) => step === "none" || step === "skipped";
  return (
    <div className={styles.rows}>
      <Row status={status.environment} label="Environment">
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
        <Row
          status={status.prerequisites}
          label={`Prerequisites (${card.prerequisites.length})`}
        >
          <Text
            color={muted(status.prerequisites) ? "text-low" : "text-mid"}
            truncate
          >
            {prerequisitesSummary(
              card.prerequisites.map((p) => p.result),
              status.prerequisites,
            )}
          </Text>
        </Row>
      ) : null}
      {card.prerequisites.map((p) => (
        <div key={p.index} className={styles.subRow}>
          {prerequisiteState(p.id, card.id)}
          <ClampedLink
            name={p.id}
            href={`/features/${p.id}`}
            className={styles.clamped}
          />
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
            value={{ kind: "value", value: status.servedDefault }}
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
  toggle,
  prerequisiteState,
}: {
  card: EnvironmentCard;
  valueType: FeatureValueType;
  toggle: ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
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
              <ReasonText reason={status.reason} />
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
  renderToggle,
  prerequisiteState,
}: {
  cards: EnvironmentCard[];
  valueType: FeatureValueType;
  renderToggle: (environment: string) => ReactNode;
  prerequisiteState: PrerequisiteStateRenderer;
}) {
  return (
    <div className={styles.grid}>
      {cards.map((card) => (
        <Card
          key={card.id}
          card={card}
          valueType={valueType}
          toggle={renderToggle(card.id)}
          prerequisiteState={prerequisiteState}
        />
      ))}
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
                state: (env: string) => prerequisiteState(p.id, env, true),
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
