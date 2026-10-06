import { Fragment, ReactNode, useMemo, useState } from "react";
import stringify from "json-stringify-pretty-compact";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { Condition, jsonToConds, useAttributeMap } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getValue,
  needsValue,
  operatorToText,
} from "@/components/Features/ConditionDisplay";
import { Popover } from "@/ui/Popover";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { EditButton } from "./SetupFunnel";
import styles from "./TargetingConditions.module.scss";

// The Targeting card's conditions, as one summary row and a popover (set in
// review), instead of every condition rendered inline: the card's height no
// longer depends on how much targeting there is.
//
// The row: "Conditions" and "View (n)", as a link (set in review), n
// counting exactly the popover's rows: attribute rules across every
// group, saved-group rules and prerequisites. It is a single button.
//
// The popover lists the rules by mechanism: attributes, saved groups,
// prerequisites. Attributes use the condition builder's own structure: one
// level of OR groups, each an AND of rules. Whether a condition can be shown
// that way is decided by the SAME test the Edit Targeting modal's builder
// uses to choose its simple editor (ConditionInput): jsonToConds with the
// project's attribute map returns null, or there are no attributes, and it's
// shown as its raw JSON instead. There's deliberately no second parser here,
// so the popover and the editor can never disagree about a condition.

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// A prerequisite's state: the other feature must be live, or (with the
// "is not live" condition) must not be. Any other condition still requires
// it to be live, plus a condition of its own on that feature's value, which
// this popover marks but doesn't render (it belongs to that feature).
function prerequisiteState(condition: string): {
  state: "is live" | "is not live";
  hasCondition: boolean;
} {
  const conds = jsonToConds(condition);
  if (conds && conds.length === 1 && conds[0].length === 1) {
    const [{ field, operator }] = conds[0];
    if (field === "value" && operator === "$exists")
      return { state: "is live", hasCondition: false };
    if (field === "value" && operator === "$notExists")
      return { state: "is not live", hasCondition: false };
  }
  return { state: "is live", hasCondition: true };
}

function SavedGroupName({ id }: { id: string }) {
  const { getSavedGroupById } = useDefinitions();
  return <>{getSavedGroupById(id)?.groupName ?? "Group was deleted"}</>;
}

// One attribute rule as its three grid cells: attribute, operator, value.
function AttributeRule({ cond }: { cond: Condition }) {
  const { getSavedGroupById } = useDefinitions();
  const { field, value } = cond;
  let { operator } = cond;
  const isSavedGroupField =
    field === "$savedGroups" || field === "$notSavedGroups";
  if (field === "$savedGroups" && operator === "$in") operator = "$inGroup";
  if (field === "$notSavedGroups" && operator === "$nin")
    operator = "$notInGroup";
  const groupIds = isSavedGroupField
    ? value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

  return (
    <>
      {isSavedGroupField ? (
        <span className={styles.attribute}>Saved group</span>
      ) : (
        <span className={styles.attribute}>{field}</span>
      )}
      <span className={styles.operator}>
        {operatorToText({
          operator,
          hasMultipleSavedGroups: groupIds.length > 1,
          isSavedGroupField,
        })}
      </span>
      <span className={styles.value}>
        {isSavedGroupField
          ? groupIds
              .map((id) => getSavedGroupById(id)?.groupName ?? id)
              .join(", ")
          : needsValue(operator)
            ? getValue(operator, value)
            : ""}
      </span>
    </>
  );
}

function RuleGrid({ conds }: { conds: Condition[] }) {
  return (
    <div className={styles.ruleGrid}>
      {conds.map((c, i) => (
        <AttributeRule key={i} cond={c} />
      ))}
    </div>
  );
}

function SavedGroupsSection({ rules }: { rules: SavedGroupTargeting[] }) {
  return (
    <div className={styles.twoColumnGrid}>
      {rules.map((r, i) => (
        <Fragment key={i}>
          <span className={styles.operator}>
            {r.match === "any"
              ? "In any of:"
              : r.match === "all"
                ? "In all of:"
                : r.ids.length > 1
                  ? "In none of:"
                  : "Not in:"}
          </span>
          <span className={styles.plainValue}>
            {r.ids.map((id, j) => (
              <Fragment key={id}>
                {j > 0 ? ", " : null}
                <SavedGroupName id={id} />
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function PrerequisitesSection({
  prerequisites,
}: {
  prerequisites: FeaturePrerequisite[];
}) {
  return (
    <div className={styles.twoColumnGrid}>
      {prerequisites.map((p) => {
        const { state, hasCondition } = prerequisiteState(p.condition);
        return (
          <Fragment key={p.id}>
            {/* The one genuine link in the popover, so the only violet. */}
            <Link
              href={`/features/${p.id}`}
              target="_blank"
              className={styles.featureLink}
            >
              {p.id}
              <PiArrowSquareOut aria-hidden />
            </Link>
            <span className={styles.operator}>
              {/* The state is the fact; "has a condition" is a quieter
                footnote to it, and the condition itself isn't shown. */}
              {state}
              {hasCondition ? (
                <span className={styles.footnote}> · has a condition</span>
              ) : null}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className={styles.sectionLabel}>{children}</div>;
}

export default function TargetingConditions({
  condition,
  savedGroups: savedGroupsProp = [],
  prerequisites: prerequisitesProp = [],
  project,
  onEdit,
}: {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
  project?: string;
  // Opens the Edit Targeting modal; no Edit link without it.
  onEdit?: (() => void) | null;
}) {
  const attributes = useAttributeMap(project);
  // Only rules that mean something (and render as a row): a saved-group rule
  // with no groups, or a prerequisite with no feature, is neither shown nor
  // counted.
  const savedGroups = savedGroupsProp.filter((r) => r.ids.length > 0);
  const prerequisites = prerequisitesProp.filter((p) => !!p.id);
  const [open, setOpen] = useState(false);

  const hasCondition = !!condition && condition !== "{}";
  // The editor's test (ConditionInput): simple view only when the builder
  // can read it and there are attributes. Otherwise, the raw JSON.
  const groups = useMemo(
    () => (hasCondition ? jsonToConds(condition ?? "", attributes) : []),
    [hasCondition, condition, attributes],
  );
  const parsedGroups = (groups ?? []).filter((g) => g.length);
  // Also JSON when the builder reads it but finds no rules in it (e.g. an
  // empty $or): the card still says Audience: Custom, so it's shown as
  // written rather than hidden. When in doubt, JSON.
  const asJson =
    hasCondition &&
    (groups === null || !attributes.size || parsedGroups.length === 0);
  const orGroups = asJson ? [] : parsedGroups;
  const json = useMemo(() => {
    if (!asJson || !condition) return "";
    try {
      return stringify(JSON.parse(condition));
    } catch {
      return condition;
    }
  }, [asJson, condition]);

  // The count is exactly the popover's rows, one each: attribute rules across
  // every group (a JSON condition is one row), saved-group rules and
  // prerequisites, never anything inside them (e.g. a prerequisite's own
  // condition).
  const attributeRowCount = asJson
    ? 1
    : orGroups.reduce((n, g) => n + g.length, 0);
  const total = attributeRowCount + savedGroups.length + prerequisites.length;
  if (!total) return null;

  const content = (
    <Box>
      <Flex justify="between" align="center" gap="3" mb="3">
        <Text weight="semibold">Targeting Conditions</Text>
        {onEdit ? (
          // The Setup page's pencil (EditButton), always shown here (set in
          // review). Opens the Edit Targeting modal.
          <EditButton
            label="Edit targeting"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          />
        ) : null}
      </Flex>
      <Flex direction="column" gap="4">
        {hasCondition ? (
          <Box>
            {/* Just "Attributes", whatever the structure (set in review). */}
            <SectionLabel>Attributes</SectionLabel>
            {asJson ? (
              // Exactly as written, read-only: nothing drawn on top of it.
              <pre className={styles.json}>{json}</pre>
            ) : orGroups.length > 1 ? (
              <Flex direction="column" gap="2">
                {orGroups.map((g, i) => (
                  <Fragment key={i}>
                    {i > 0 ? <div className={styles.or}>OR</div> : null}
                    <div className={styles.orGroup}>
                      <div className={styles.allOf}>All of:</div>
                      <RuleGrid conds={g} />
                    </div>
                  </Fragment>
                ))}
              </Flex>
            ) : (
              <RuleGrid conds={orGroups[0] ?? []} />
            )}
          </Box>
        ) : null}
        {savedGroups.length ? (
          <Box>
            <SectionLabel>Saved groups</SectionLabel>
            <SavedGroupsSection rules={savedGroups} />
          </Box>
        ) : null}
        {prerequisites.length ? (
          <Box>
            <SectionLabel>Prerequisites</SectionLabel>
            <PrerequisitesSection prerequisites={prerequisites} />
          </Box>
        ) : null}
      </Flex>
    </Box>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      showArrow={false}
      contentClassName={styles.popover}
      content={content}
      trigger={
        // The whole row is the one control: a single tab stop, named for
        // what it opens. It reads like the card's other label/value rows.
        <button
          type="button"
          className={styles.row}
          aria-label={`Targeting conditions, ${plural(total, "rule")}`}
        >
          <span className={styles.label}>Conditions</span>
          {/* "View (n)", as a link: the visible sign that the row opens
            something, with the count (set in review). The row is the hit
            area. */}
          <span className={styles.count} aria-hidden>
            {`View (${total})`}
          </span>
        </button>
      }
    />
  );
}
