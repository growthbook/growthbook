import { FeatureValueType } from "back-end/types/feature";
import { useMemo } from "react";
import Code from "../Code";
import stringify from "json-stringify-pretty-compact";

export default function ValueDisplay({
  value,
  type,
  full = true,
}: {
  value: string;
  type: FeatureValueType;
  full?: boolean;
}) {
  const formatted = useMemo(() => {
    if (type === "boolean") return value;
    if (type === "number") return value;
    if (type === "string") return '"' + value + '"';
    try {
      return stringify(JSON.parse(value));
    } catch (e) {
      return value;
    }
  }, [value, type]);

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

  if (!full) {
    return (
      <div
        style={{
          textOverflow: "ellipsis",
          overflow: "hidden",
          maxWidth: "180px",
          whiteSpace: "nowrap",
        }}
        className="text-muted"
      >
        {formatted}
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 150, overflowY: "auto" }}>
      <Code
        language="json"
        code={formatted}
        theme="light"
        className="m-0 p-0 border-0 bg-transparent"
      />
    </div>
  );
}
