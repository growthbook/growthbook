import { FeatureValueType } from "back-end/types/feature";
import Code from "../Code";
import ReadonlyToggle from "../Forms/ReadonlyToggle";

export default function ValueDisplay({
  value,
  type,
}: {
  value: string;
  type: FeatureValueType;
}) {
  if (type === "boolean") {
    return <ReadonlyToggle value={value !== "false"} />;
  }

  if (type === "string") {
    return <span>{value}</span>;
  }

  if (type === "number") {
    return <span className="badge badge-info">{value}</span>;
  }

  return <Code language="json" code={value} />;
}
