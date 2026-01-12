import stringify from "json-stringify-pretty-compact";
import { ReactNode, useMemo } from "react";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { isDefined } from "shared/util";
import { SavedGroupInterface } from "shared/types/groups";
import { Flex, Text } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Condition, jsonToConds, useAttributeMap } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import styles from "./ConditionDisplay.module.scss";

type ConditionWithParentId = Condition & { parentId?: string };

function operatorToText({
  operator,
  isPrerequisite,
  hasMultipleSavedGroups,
}: {
  operator: string;
  isPrerequisite?: boolean;
  hasMultipleSavedGroups?: boolean;
}): string {
  switch (operator) {
    case "$eq":
    case "$veq":
      return `=`;
    case "$ne":
    case "$vne":
      return `≠`;
    case "$includes":
      return `includes`;
    case "$notIncludes":
      return `does not include`;
    case "$empty":
      return `is empty`;
    case "$notEmpty":
      return `is not empty`;
    case "$lt":
    case "$vlt":
      return `<`;
    case "$lte":
    case "$vlte":
      return `≤`;
    case "$gt":
    case "$vgt":
      return `>`;
    case "$gte":
    case "$vgte":
      return `≥`;
    case "$exists":
      return isPrerequisite ? `is live` : `is not NULL`;
    case "$notExists":
      return isPrerequisite ? `is not live` : `is NULL`;
    case "$in":
      return `is in the list`;
    case "$nin":
      return `is not in the list`;
    case "$inGroup":
      return `is in the saved group${hasMultipleSavedGroups ? "s" : ""}`;
    case "$notInGroup":
      return `is not in the saved group${hasMultipleSavedGroups ? "s" : ""}`;
    case "$true":
      return "is";
    case "$false":
      return "is";
    case "$regex":
      return `matches the pattern`;
    case "$notRegex":
      return `does not match the pattern`;
  }
  return operator;
}

function needsValue(operator: string) {
  return !["$exists", "$notExists", "$empty", "$notEmpty"].includes(operator);
}
function hasMultiValues(operator: string) {
  return ["$in", "$nin"].includes(operator);
}
function getValue(
  operator: string,
  value: string,
  savedGroups?: SavedGroupInterface[],
): string {
  if (operator === "$true") return "TRUE";
  if (operator === "$false") return "FALSE";

  // Get the groupName from the associated group.id to display a human readable name.
  if ((operator === "$inGroup" || operator === "$notInGroup") && savedGroups) {
    const index = savedGroups.find((i) => i.id === value);
    return index?.groupName || "Group was Deleted";
  }
  return value;
}

const MULTI_VALUE_LIMIT = 3;

export function MultiValuesDisplay({
  values,
  displayMap,
  savedGroupIds,
}: {
  values: string[];
  displayMap?: Record<string, string>;
  savedGroupIds?: Set<string>;
}) {
  const { getSavedGroupById } = useDefinitions();

  return (
    <>
      {values.slice(0, MULTI_VALUE_LIMIT).map((v, i) => {
        const isSavedGroup = savedGroupIds?.has(v);
        const group = isSavedGroup ? getSavedGroupById(v) : null;

        const displayValue =
          isSavedGroup && group
            ? displayMap?.[v] || group.groupName
            : displayMap?.[v] || v;
        return (
          <Badge
            key={i}
            color="gray"
            className="text-ellipsis d-inline-block"
            style={{ maxWidth: 300 }}
            title={displayValue}
            label={
              isSavedGroup && group ? (
                <Link
                  href={`/saved-groups/${group.id}`}
                  target="_blank"
                  size="1"
                  color="violet"
                  title="Manage Saved Group"
                >
                  {displayValue} <PiArrowSquareOut />
                </Link>
              ) : (
                <Text style={{ color: "var(--slate-12)" }}>{displayValue}</Text>
              )
            }
          />
        );
      })}
      {values.length > MULTI_VALUE_LIMIT && (
        <Tooltip
          body={
            <div>
              {values.slice(MULTI_VALUE_LIMIT).map((v, i) => {
                const isSavedGroup = savedGroupIds?.has(v);
                const group = isSavedGroup ? getSavedGroupById(v) : null;
                return (
                  <span key={i} className={`${styles.Tooltip} ml-1`}>
                    {isSavedGroup && group
                      ? group.groupName
                      : displayMap?.[v] || v}
                  </span>
                );
              })}
            </div>
          }
          usePortal
        >
          <span className="mr-1">
            <em>+ {values.length - MULTI_VALUE_LIMIT} more</em>
          </span>
        </Tooltip>
      )}
    </>
  );
}

function MultiValueDisplay({
  value,
  displayMap,
  noParensForSingleValue = false,
  savedGroupIds,
}: {
  value: string;
  displayMap?: Record<string, string>;
  noParensForSingleValue?: boolean;
  savedGroupIds?: Set<string>;
}) {
  const parts = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const skipParens = noParensForSingleValue && parts.length <= 1;

  if (!parts.length) {
    return (
      <span className="mr-1">
        <em>empty list</em>
      </span>
    );
  }
  return (
    <>
      {!skipParens && <span>(</span>}
      <MultiValuesDisplay
        values={parts}
        displayMap={displayMap}
        savedGroupIds={savedGroupIds}
      />
      {!skipParens && <span>)</span>}
    </>
  );
}

function getConditionOrParts({
  conditions,
  savedGroups,
  initialAnd = false,
  renderPrerequisite = false,
  keyPrefix = "",
}: {
  conditions: ConditionWithParentId[][];
  savedGroups?: SavedGroupInterface[];
  initialAnd?: boolean;
  renderPrerequisite?: boolean;
  keyPrefix?: string;
}) {
  if (conditions.length === 0) return [];
  if (conditions.length === 1) {
    return getConditionParts({
      conditions: conditions[0],
      savedGroups,
      initialAnd,
      renderPrerequisite,
      keyPrefix,
    });
  }

  const parts: ReactNode[] = [];

  if (initialAnd) {
    parts.push(<div key={keyPrefix + "and-start"}>AND {"["}</div>);
  }

  conditions.forEach((condGroup, i) => {
    if (i > 0) {
      parts.push(
        <div key={keyPrefix + "or-sep-" + i}>
          <Text weight="medium">OR</Text>
        </div>,
      );
    }
    parts.push(<div key={keyPrefix + "or-start-" + i}>{"("}</div>);
    parts.push(
      ...getConditionParts({
        conditions: condGroup,
        savedGroups,
        initialAnd: false,
        renderPrerequisite,
        keyPrefix: `${keyPrefix}or-${i}-`,
      }),
    );
    parts.push(<div key={keyPrefix + "or-end-" + i}>{")"}</div>);
  });

  if (initialAnd) {
    parts.push(<div key={keyPrefix + "and-end"}>{"]"}</div>);
  }

  return parts;
}

function getConditionParts({
  conditions,
  savedGroups,
  initialAnd = false,
  renderPrerequisite = false,
  keyPrefix = "",
}: {
  conditions: ConditionWithParentId[];
  savedGroups?: SavedGroupInterface[];
  initialAnd?: boolean;
  renderPrerequisite?: boolean;
  keyPrefix?: string;
}) {
  return conditions.map(({ field, operator, value, parentId }, i) => {
    let fieldEl: ReactNode = (
      <Badge
        color="gray"
        className="text-ellipsis d-inline-block"
        style={{ maxWidth: 300 }}
        title={field}
        label={<Text style={{ color: "var(--slate-12)" }}>{field}</Text>}
      />
    );
    let parentIdEl: ReactNode = null;
    if (renderPrerequisite) {
      if (field === "value") {
        fieldEl = null;
      } else if (field.substring(0, 6) === "value.") {
        const displayValue = field.substring(6);
        fieldEl = (
          <Badge
            color="gray"
            className="text-ellipsis d-inline-block"
            style={{ maxWidth: 300 }}
            title={displayValue}
            label={
              <Text style={{ color: "var(--slate-12)" }}>{displayValue}</Text>
            }
          />
        );
      } else {
        fieldEl = (
          <Tooltip
            className="mr-1 border px-2 alert-danger rounded text-danger"
            body={
              <>
                Prerequisite targeting conditions must reference{" "}
                <code>value</code> as the root element
              </>
            }
          >
            {field}
          </Tooltip>
        );
      }
      if (parentId) {
        parentIdEl = (
          <>
            <Text>prerequisite</Text>
            <ParentIdLink parentId={parentId} />
          </>
        );
      }
    }

    // For saved groups, hide the "field" element and tweak the operator
    if (field === "$savedGroups") {
      fieldEl = null;
      if (operator === "$in") {
        operator = "$inGroup";
      } else if (operator === "$nin") {
        operator = "$notInGroup";
      }
    }

    const savedGroupValueParts =
      field === "$savedGroups"
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];
    const hasMultipleSavedGroups = savedGroupValueParts.length > 1;

    // Extract variables for saved group value display
    const group =
      (operator === "$inGroup" || operator === "$notInGroup") && savedGroups
        ? savedGroups.find((sg) => sg.id === value)
        : undefined;
    const displayValue = getValue(operator, value, savedGroups);

    return (
      <Flex wrap="wrap" key={keyPrefix + i} gap="2">
        {(i > 0 || initialAnd) && <Text weight="medium">AND</Text>}
        {parentIdEl}
        {fieldEl}
        <span className="mr-1">
          {operatorToText({
            operator,
            isPrerequisite: renderPrerequisite,
            hasMultipleSavedGroups,
          })}
        </span>
        {field === "$savedGroups" ? (
          <MultiValueDisplay
            value={value}
            displayMap={Object.fromEntries(
              (savedGroups || []).map((sg) => [sg.id, sg.groupName]),
            )}
            noParensForSingleValue={true}
            savedGroupIds={
              new Set(
                value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
        ) : hasMultiValues(operator) ? (
          <MultiValueDisplay value={value} />
        ) : needsValue(operator) ? (
          (operator === "$inGroup" || operator === "$notInGroup") &&
          savedGroups ? (
            group ? (
              <Badge
                color="gray"
                className="text-ellipsis d-inline-block"
                style={{ maxWidth: 300 }}
                title="Manage Saved Group"
                label={
                  <Link
                    href={`/saved-groups/${group.id}`}
                    target="_blank"
                    size="1"
                    color="violet"
                  >
                    {group.groupName} <PiArrowSquareOut />
                  </Link>
                }
              />
            ) : (
              <Badge
                color="gray"
                className="text-ellipsis d-inline-block"
                style={{ maxWidth: 300 }}
                title={displayValue}
                label={
                  <Text style={{ color: "var(--slate-12)", whiteSpace: "pre" }}>
                    {displayValue}
                  </Text>
                }
              />
            )
          ) : (
            <Badge
              color="gray"
              className="text-ellipsis d-inline-block"
              style={{ maxWidth: 300 }}
              title={displayValue}
              label={
                <Text style={{ color: "var(--slate-12)", whiteSpace: "pre" }}>
                  {displayValue}
                </Text>
              }
            />
          )
        ) : (
          ""
        )}
      </Flex>
    );
  });
}

function ParentIdLink({ parentId }: { parentId: string }) {
  return (
    <Badge
      color="gray"
      className="text-ellipsis d-inline-block"
      style={{ maxWidth: 300 }}
      title={parentId}
      label={
        <Link
          href={`/features/${parentId}`}
          title="Manage Feature"
          size="1"
          target="_blank"
          color="violet"
        >
          {parentId}
        </Link>
      }
    />
  );
}

export default function ConditionDisplay({
  condition,
  savedGroups: savedGroupTargeting,
  prerequisites,
}: {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
}) {
  const { savedGroups } = useDefinitions();
  const attributes = useAttributeMap();

  const parts: ReactNode[] = [];
  let partId = 0;

  const jsonFormattedCondition = useMemo(() => {
    if (!condition) return;
    try {
      const parsed = JSON.parse(condition);
      return stringify(parsed);
    } catch (e) {
      console.error(e);
      return condition;
    }
  }, [condition]);

  if (savedGroupTargeting && savedGroupTargeting.length > 0) {
    parts.push(
      <SavedGroupTargetingDisplay
        savedGroups={savedGroupTargeting}
        groupClassName="col-auto"
        initialAnd={parts.length > 0}
        key={`${partId++}-saved-group-targeting`}
      />,
    );
  }

  if (prerequisites) {
    const prereqConditionsGrouped = prerequisites
      .map((p) => {
        const cond = jsonToConds(p.condition);
        if (!cond || cond.length > 1) {
          let jsonFormattedCondition = p.condition;
          try {
            const parsed = JSON.parse(p.condition);
            jsonFormattedCondition = stringify(parsed);
          } catch (e) {
            console.error(e, p.condition);
          }
          parts.push(
            <Flex wrap="wrap" gap="2" key={partId++} className="w-100 col-auto">
              {parts.length > 0 && <Text weight="medium">AND</Text>}
              <Text>prerequisite</Text>
              <ParentIdLink parentId={p.id} />
              <InlineCode language="json" code={jsonFormattedCondition} />
            </Flex>,
          );
          return;
        }
        return cond[0]?.map(({ field, operator, value }) => {
          return {
            field,
            operator,
            value,
            parentId: p.id,
          };
        });
      })
      .filter(isDefined);

    const prereqConds =
      prereqConditionsGrouped.reduce(
        (acc, val) => val && acc.concat(val),
        [],
      ) || [];

    const prereqParts = getConditionParts({
      conditions: prereqConds,
      savedGroups,
      renderPrerequisite: true,
      initialAnd: parts.length > 0,
      keyPrefix: `${partId++}-prereq-`,
    });
    parts.push(...prereqParts);
  }

  if (condition && jsonFormattedCondition) {
    const conds = jsonToConds(condition);
    // Could not parse into simple conditions
    if (conds === null || !attributes.size) {
      parts.push(
        <div className="w-100" key={partId++}>
          <InlineCode language="json" code={jsonFormattedCondition} />
        </div>,
      );
    } else {
      const conditionParts = getConditionOrParts({
        conditions: conds,
        savedGroups,
        keyPrefix: `${partId++}-condition-`,
        initialAnd: parts.length > 0,
      });
      parts.push(...conditionParts);
    }
  }

  return (
    <Flex gapX="3" gapY="2" wrap="wrap">
      {parts}
    </Flex>
  );
}
