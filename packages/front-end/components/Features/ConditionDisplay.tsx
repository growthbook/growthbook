import { jsonToConds, useAttributeMap } from "../../services/features";
import Code from "../Code";

function operatorToText(operator: string): string {
  switch (operator) {
    case "$eq":
      return `is equal to`;
    case "$ne":
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
      return `is less than`;
    case "$lte":
      return `is less than or equal to`;
    case "$gt":
      return `is greater than`;
    case "$gte":
      return `is greater than or equal to`;
    case "$exists":
      return `exists`;
    case "$notExists":
      return `does not exist`;
    case "$in":
      return `is in the list`;
    case "$nin":
      return `is not in the list`;
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
function getValue(operator: string, value: string): string {
  if (operator === "$true") return "TRUE";
  if (operator === "$false") return "FALSE";
  return value;
}

export default function ConditionDisplay({ condition }: { condition: string }) {
  const conds = jsonToConds(condition);

  const attributes = useAttributeMap();

  // Could not parse into simple conditions
  if (conds === null || !attributes.size) {
    return (
      <Code
        language="json"
        code={condition}
        theme="light"
        className="p-0 border-0"
        actionBar={false}
        containerClassName="m-0"
      />
    );
  }

  return (
    <div className="row">
      {conds.map(({ field, operator, value }, i) => (
        <div key={i} className="col-auto d-flex flex-wrap">
          {i > 0 && <span className="mr-1">AND</span>}
          <span className="mr-1 border px-2 bg-light rounded">{field}</span>
          <span className="mr-1">{operatorToText(operator)}</span>
          {needsValue(operator) ? (
            <span className="mr-1 border px-2 bg-light rounded">
              {getValue(operator, value)}
            </span>
          ) : (
            ""
          )}
        </div>
      ))}
    </div>
  );
}
