import { SDKAttributeType } from "back-end/types/organization";
import { jsonToConds, useAttributeMap } from "../../services/features";
import Code from "../Code";

function operatorToText(operator: string, type: SDKAttributeType): string {
  switch (operator) {
    case "$eq":
      if (type === "number[]" || type === "string[]") return `contains`;
      return `is equal to`;
    case "$ne":
      if (type === "number[]" || type === "string[]") return `does not contain`;
      return `is not equal to`;
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
      return `is TRUE`;
    case "$false":
      return `is FALSE`;
    case "$regex":
      return `matches the pattern`;
    case "$notRegex":
      return `does not match the pattern`;
  }
  return operator;
}

function needsValue(operator: string) {
  return !["$true", "$false", "$exists", "$notExists"].includes(operator);
}

export default function ConditionDisplay({ condition }: { condition: string }) {
  const conds = jsonToConds(condition);

  const [hasAttributes, attributeType] = useAttributeMap();

  // Could not parse into simple conditions
  if (conds === null || !hasAttributes) {
    return <Code language="json" code={condition} />;
  }

  return (
    <div className="row">
      {conds.map(({ field, operator, value }, i) => (
        <div key={i} className="col-auto d-flex flex-wrap">
          {i > 0 && <strong className="mr-2">AND</strong>}
          <span className="mr-2">{field}</span>
          <strong className="mr-2">
            {operatorToText(operator, attributeType[field] || "string")}
          </strong>
          {needsValue(operator) ? <span>{value}</span> : ""}
        </div>
      ))}
    </div>
  );
}
