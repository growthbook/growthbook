import { Fragment, ReactNode, useState } from "react";
import { Separator } from "@radix-ui/themes";
import { PiCheckBold, PiEye, PiMinusCircle } from "react-icons/pi";
import {
  DecisionCriteriaAction,
  DecisionCriteriaCondition,
  DecisionCriteriaData,
} from "shared/types/experiment";
import { Popover } from "@/ui/Popover";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./DecisionRulesPopover.module.scss";

// "View Rules" opens the decision criteria's rules in a popover beside the
// link (set in review), instead of the read-only Decision Criteria modal:
// the name and description, then the rules in order, each a numbered set of
// conditions and the action it leads to, then "Otherwise" and the default
// action. Read straight from the criteria, so presets and custom criteria
// both render.

// One condition as a sentence: "All goal metrics are ↑ Stat Sig Good", "no
// guardrail is ↓ Stat Sig Bad". The quantifier is bold; the result is
// coloured by direction.
function ConditionText({
  condition,
  first,
}: {
  condition: DecisionCriteriaCondition;
  first: boolean;
}) {
  const { match, metrics, direction } = condition;
  const plural = match === "all";
  const quantifier =
    match === "all" ? "All" : match === "any" ? "Any" : first ? "No" : "no";
  const noun =
    metrics === "goals"
      ? plural
        ? "goal metrics"
        : "goal metric"
      : plural
        ? "guardrails"
        : "guardrail";
  const good = direction === "statsigWinner";
  return (
    <span className={styles.condition}>
      {!first ? <span className={styles.and}>AND </span> : null}
      <span className={styles.quantifier}>{quantifier}</span> {noun}{" "}
      {plural ? "are" : "is"}{" "}
      <span className={good ? styles.good : styles.bad}>
        {good ? "↑ Stat Sig Good" : "↓ Stat Sig Bad"}
      </span>
    </span>
  );
}

const ACTIONS: Record<
  DecisionCriteriaAction,
  { label: string; icon: ReactNode; className: string }
> = {
  ship: {
    label: "Ship",
    icon: <PiCheckBold size={14} />,
    className: styles.ship,
  },
  rollback: {
    label: "Rollback",
    icon: <PiMinusCircle size={14} />,
    className: styles.rollback,
  },
  review: {
    label: "Review",
    icon: <PiEye size={14} />,
    className: styles.review,
  },
};

function Action({ action }: { action: DecisionCriteriaAction }) {
  const { label, icon, className } = ACTIONS[action];
  return (
    <span className={`${styles.action} ${className}`}>
      <span className={styles.actionIcon} aria-hidden>
        {icon}
      </span>
      {label}
    </span>
  );
}

export default function DecisionRulesPopover({
  criteria,
}: {
  criteria: DecisionCriteriaData;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      sideOffset={4}
      showArrow={false}
      contentClassName={styles.popover}
      // 16px all round, as the goal metric popover.
      contentStyle={{ padding: "var(--space-4)" }}
      trigger={
        // 12px (Radix size 1), as before. Radix's trigger opens it; the
        // link's own click does nothing more.
        // No padding of its own, so the 4px gap is measured from the
        // link's text (set in review).
        <Link size="sm" className={styles.trigger} onClick={() => {}}>
          View Rules
        </Link>
      }
      content={
        <div>
          <Text as="div" weight="semibold">
            {criteria.name}
          </Text>
          {criteria.description ? (
            // --slate-11, the Actions menu's description colour (set in
            // review). OFF THE TEXT TOKENS: @/ui/Text's colours are the four
            // text tokens only, so it's set on the paragraph.
            //
            // Each sentence starts on its own line, so a wrap never leaves
            // the end of one sentence stranded beside the start of the next
            // (set in review, for "Do No Harm"). Split only where a sentence
            // ends and a capitalised one begins, so "e.g. something" stays
            // together.
            <p className={styles.description}>
              {criteria.description
                .split(/(?<=[.!?])\s+(?=[A-Z])/)
                .map((sentence, i) => (
                  <span key={i} className={styles.sentence}>
                    {sentence}
                  </span>
                ))}
            </p>
          ) : null}
          <Separator size="4" my="3" className={styles.separator} />
          {/* The page text colour, as the "Timing" label (set in review). */}
          <p className={styles.note}>Evaluated in order — first match wins.</p>
          <ol className={styles.rules}>
            {criteria.rules.map((rule, i) => (
              <li key={i} className={styles.rule}>
                <span className={styles.number}>{i + 1}</span>
                <span className={styles.conditions}>
                  {rule.conditions.map((c, j) => (
                    <Fragment key={j}>
                      <ConditionText condition={c} first={j === 0} />
                    </Fragment>
                  ))}
                </span>
                <Action action={rule.action} />
              </li>
            ))}
            <li className={styles.rule}>
              <span className={styles.number} aria-hidden />
              <span className={styles.otherwise}>Otherwise</span>
              <Action action={criteria.defaultAction} />
            </li>
          </ol>
        </div>
      }
    />
  );
}
