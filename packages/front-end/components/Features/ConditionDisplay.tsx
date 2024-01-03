import { SavedGroupInterface } from "back-end/types/saved-group";
import stringify from "json-stringify-pretty-compact";
import { useMemo } from "react";
import { SavedGroupTargeting } from "back-end/types/feature";
import { useDefinitions } from "@/services/DefinitionsContext";
import { jsonToConds, useAttributeMap } from "@/services/features";
import InlineCode from "../SyntaxHighlighting/InlineCode";
import SavedGroupTargetingDisplay from "./SavedGroupTargetingDisplay";
import Tooltip from "@/components/Tooltip/Tooltip";

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
function getValue(
  operator: string,
  value: string,
  savedGroups?: SavedGroupInterface[]
): string {
  if (operator === "$true") return "TRUE";
  if (operator === "$false") return "FALSE";

  // Get the groupName from the associated group.id to display a human readable name.
  if (operator === ("$inGroup" || "$notInGroup") && savedGroups) {
    const index = savedGroups.find((i) => i.id === value);

    return index?.groupName || "Group was Deleted";
  }
  return value;
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

  const parts = conds.map(({ field, operator, value }, i) => {
    return(
      <div key={i} className="col-auto d-flex flex-wrap">
        {i > 0 && <span className="mr-1">AND</span>}
        <span className="mr-1 border px-2 bg-light rounded">
          {field}
          {field === "@parent" && (
            <Tooltip className="ml-1" body="The evaluated value of the prerequisite feature" />
          )}
        </span>
        <span className="mr-1">{operatorToText(operator)}</span>
        {needsValue(operator) ? (
          <span className="mr-1 border px-2 bg-light rounded">
            {getValue(operator, value, savedGroups)}
          </span>
        ) : (
          ""
        )}
      </div>
    );
  });

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
