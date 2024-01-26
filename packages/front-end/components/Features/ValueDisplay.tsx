import { FeatureValueType } from "back-end/types/feature";
import {CSSProperties, useMemo} from "react";
import stringify from "json-stringify-pretty-compact";
import InlineCode from "../SyntaxHighlighting/InlineCode";

export default function ValueDisplay({
  value,
  type,
  full = true,
  fullStyle = { maxHeight: 150, overflowY: "auto", maxWidth: "100%" }
}: {
  value: string;
  type: FeatureValueType;
  full?: boolean;
  fullStyle?: CSSProperties;
}) {
  const formatted = useMemo(() => {
    if (type === "boolean") return value;
    if (type === "number") return value || "null";
    if (type === "string") return '"' + value + '"';
    try {
      return stringify(JSON.parse(value));
    } catch (e) {
      return value;
    }
  }, [value, type]);

  if (type === "boolean") {
    const on = !(value === "false" || !value);
    return (
      <span>
        <div
          style={{
            display: "inline-block",
            height: 10,
            width: 10,
            borderRadius: 10,
            marginRight: 5,
            backgroundColor: on ? "#3aa8e8" : "#cccccc",
          }}
        ></div>
        {on ? "ON" : "OFF"}
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
    <div style={fullStyle}>
      <InlineCode language="json" code={formatted} />
    </div>
  );
}
