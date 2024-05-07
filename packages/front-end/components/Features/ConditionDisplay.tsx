import { SavedGroupInterface } from "back-end/types/saved-group";
import stringify from "json-stringify-pretty-compact";
import { ReactNode, useMemo } from "react";
import {
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "back-end/types/feature";
import Link from "next/link";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Condition, jsonToConds, useAttributeMap } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import SavedGroupTargetingDisplay from "./SavedGroupTargetingDisplay";

type ConditionWithParentId = Condition & { parentId?: string };

function operatorToText(operator: string, isPrerequisite?: boolean): string {
  switch (operator) {
    case "$eq":
    case "$veq":
      return `is equal to`;
    case "$ne":
    case "$vne":
      return `is not equal to`;
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
      return `is less than`;
    case "$lte":
    case "$vlte":
      return `is less than or equal to`;
    case "$gt":
    case "$vgt":
      return `is greater than`;
    case "$gte":
    case "$vgte":
      return `is greater than or equal to`;
    case "$exists":
      return isPrerequisite ? `is live` : `is not NULL`;
    case "$notExists":
      return isPrerequisite ? `is not live` : `is NULL`;
    case "$in":
      return `is in the list`;
    case "$nin":
      return `is not in the list`;
    case "$inGroup":
      return `is in the saved group`;
    case "$notInGroup":
      return `is not in the saved group`;
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

export function MultiValuesDisplay({ values }: { values: string[] }) {
  return (
    <>
      {values.slice(0, MULTI_VALUE_LIMIT).map((v, i) => (
        <span key={i} className="mr-1 border px-2 bg-light rounded">
          {v}
        </span>
      ))}
      {values.length > MULTI_VALUE_LIMIT && (
        <Tooltip
          body={
            <div>
              {values.slice(MULTI_VALUE_LIMIT).map((v, i) => (
                <span key={i} className="mr-1 border px-2 bg-light rounded">
                  {v}
                </span>
              ))}
            </div>
          }
        >
          <span className="mr-1">
            <em>+ {values.length - MULTI_VALUE_LIMIT} more</em>
          </span>
        </Tooltip>
      )}
    </>
  );
}

function MultiValueDisplay({ value }: { value: string }) {
  const parts = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!parts.length) {
    return (
      <span className="mr-1">
        <em>empty list</em>
      </span>
    );
  }
  return (
    <>
      <span className="mr-1">(</span>
      <MultiValuesDisplay values={parts} />)
    </>
  );
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
      <span className="mr-1 border px-2 bg-light rounded">{field}</span>
    );
    let parentIdEl: ReactNode = null;
    if (renderPrerequisite) {
      if (field === "value") {
        fieldEl = null;
      } else if (field.substring(0, 6) === "value.") {
        fieldEl = (
          <span className="mr-1 border px-2 bg-light rounded">
            {field.substring(6)}
          </span>
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
            <div className="mr-1">prerequisite</div>
            <ParentIdLink parentId={parentId} />
          </>
        );
      }
    }
    return (
      <div key={keyPrefix + i} className="col-auto d-flex flex-wrap">
        {(i > 0 || initialAnd) && <span className="mr-1">AND</span>}
        {parentIdEl}
        {fieldEl}
        <span className="mr-1">
          {operatorToText(operator, renderPrerequisite)}
        </span>
        {hasMultiValues(operator) ? (
          <MultiValueDisplay value={value} />
        ) : needsValue(operator) ? (
          <span className="mr-1 border px-2 bg-light rounded">
            {getValue(operator, value, savedGroups)}
          </span>
        ) : (
          ""
        )}
      </div>
    );
  });
}

function ParentIdLink({ parentId }: { parentId: string }) {
  return (
    <Link
      href={`/features/${parentId}`}
      key={`link-${parentId}`}
      className={`border px-2 bg-light rounded mr-1`}
      title="Manage Feature"
    >
      {parentId}
    </Link>
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
      const conditionParts = getConditionParts({
        conditions: conds,
        savedGroups,
        keyPrefix: `${partId++}-condition-`,
      });
      parts.push(...conditionParts);
    }
  }

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
        let cond = jsonToConds(p.condition);
        if (!cond) {
          let jsonFormattedCondition = p.condition;
          try {
            const parsed = JSON.parse(p.condition);
            jsonFormattedCondition = stringify(parsed);
          } catch (e) {
            console.error(e, p.condition);
          }
          parts.push(
            <div className="w-100 d-flex col-auto" key={partId++}>
              {parts.length > 0 && <div className="mr-1">AND</div>}
              <div className="mr-1">prerequisite</div>
              <ParentIdLink parentId={p.id} />
              <InlineCode language="json" code={jsonFormattedCondition} />
            </div>,
          );
          return;
        }
        cond = cond.map(({ field, operator, value }) => {
          return {
            field,
            operator,
            value,
            parentId: p.id,
          };
        });
        return cond;
      })
      .filter(Boolean) as ConditionWithParentId[][];

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

  return <div className="row">{parts}</div>;
}
