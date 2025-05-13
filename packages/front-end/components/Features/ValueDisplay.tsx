import { FeatureValueType } from "back-end/types/feature";
import { CSSProperties, useMemo } from "react";
import stringify from "json-stringify-pretty-compact";
import dynamic from "next/dynamic";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { toDiffableJSON } from "@/services/json";

export default function ValueDisplay({
  value,
  type,
  full = true,
  additionalStyle = {},
  fullStyle = { maxHeight: 150, overflowY: "auto", maxWidth: "100%" },
  defaultVal = "",
}: {
  value: string;
  type: FeatureValueType;
  full?: boolean;
  additionalStyle?: CSSProperties;
  fullStyle?: CSSProperties;
  defaultVal?: string;
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
      <span className="text-gray font-weight-bold">
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
        {on ? "TRUE" : "FALSE"}
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
          ...additionalStyle,
        }}
        className="text-muted"
      >
        {formatted}
      </div>
    );
  }

  if (type === "json" && defaultVal != "") {
    // the json diff code needs a window to attach to, so must be loaded dynamically
    const JsonDiff = dynamic(() => import("../Features/JsonDiff"), {
      ssr: false,
    });

    return (
      <JsonDiff
        value={toDiffableJSON(value)}
        defaultVal={toDiffableJSON(defaultVal)}
      />
    );
  }

  return (
    <div style={fullStyle}>
      <InlineCode language="json" code={formatted} />
    </div>
  );
}
