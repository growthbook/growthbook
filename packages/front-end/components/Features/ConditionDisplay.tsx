import { SavedGroupInterface } from "back-end/types/saved-group";
import stringify from "json-stringify-pretty-compact";
import { useMemo } from "react";
import { SavedGroupTargeting } from "back-end/types/feature";
import { useDefinitions } from "@/services/DefinitionsContext";
import { jsonToConds, useAttributeMap } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "../SyntaxHighlighting/InlineCode";
import SavedGroupTargetingDisplay from "./SavedGroupTargetingDisplay";

function operatorToText(operator: string): string {
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
      return `exists`;
    case "$notExists":
      return `does not exist`;
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
  savedGroups?: SavedGroupInterface[]
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

export default function ConditionDisplay({
  condition,
  savedGroups: savedGroupTargeting,
}: {
  condition: string;
  savedGroups?: SavedGroupTargeting[];
}) {
  const { savedGroups } = useDefinitions();

  const jsonFormatted = useMemo(() => {
    try {
      const parsed = JSON.parse(condition);
      return stringify(parsed);
    } catch (e) {
      console.error(e);
      return condition;
    }
  }, [condition]);

  const conds = jsonToConds(condition);

  const attributes = useAttributeMap();

  // Could not parse into simple conditions
  if (conds === null || !attributes.size) {
    return <InlineCode language="json" code={jsonFormatted} />;
  }

  const parts = conds.map(({ field, operator, value }, i) => (
    <div key={i} className="col-auto d-flex flex-wrap">
      {i > 0 && <span className="mr-1">AND</span>}
      <span className="mr-1 border px-2 bg-light rounded">
        {field}
        {field === "@parent" && (
          <Tooltip
            className="ml-1"
            body="The evaluated value of the prerequisite feature"
          />
        )}
      </span>
      <span className="mr-1">{operatorToText(operator)}</span>
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
  ));

  if (savedGroupTargeting && savedGroupTargeting.length > 0) {
    parts.push(
      <SavedGroupTargetingDisplay
        savedGroups={savedGroupTargeting}
        groupClassName="col-auto"
        initialAnd={parts.length > 0}
        key="saved-group-targeting"
      />
    );
  }

  return <div className="row">{parts}</div>;
}
