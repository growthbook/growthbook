import { FeatureValueType } from "back-end/types/feature";
import Code from "../Code";

export default function ValueDisplay({
  value,
  type,
}: {
  value: string;
  type: FeatureValueType;
}) {
  if (type === "boolean") {
    return (
      <span>
        <div
          className={value === "false" ? "bg-danger" : "bg-success"}
          style={{
            display: "inline-block",
            height: 10,
            width: 10,
            borderRadius: 10,
            marginRight: 5,
          }}
        ></div>
        {value === "false" ? "OFF" : "ON"}
      </span>
    );
  }

  if (type === "string") {
    return <span className="badge badge-primary">{value}</span>;
  }

  if (type === "number") {
    return <span className="badge badge-primary">{value}</span>;
  }

  return (
    <div style={{ maxHeight: 150, overflowY: "auto" }}>
      <Code language="json" code={value} />
    </div>
  );
}
