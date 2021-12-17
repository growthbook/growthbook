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
      <strong>
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
      </strong>
    );
  }

  if (type === "string") {
    return <strong>{value}</strong>;
  }

  if (type === "number") {
    return <strong>{value}</strong>;
  }

  return (
    <div style={{ maxHeight: 150, overflowY: "auto" }}>
      <Code language="json" code={value} />
    </div>
  );
}
