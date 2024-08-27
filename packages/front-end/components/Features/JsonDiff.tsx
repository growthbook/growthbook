import CSSProperties from "react";
import ReactJsonViewCompare from "react-json-view-compare";

export default function JsonDiff({
  value,
  defaultVal,
  fullStyle = { maxHeight: 250, overflowY: "auto", maxWidth: "100%" },
}: {
  value: string;
  defaultVal: string;
  fullStyle?: CSSProperties;
}) {
  return (
    <div style={fullStyle}>
      <ReactJsonViewCompare
        oldData={JSON.parse(defaultVal)}
        newData={JSON.parse(value)}
      />
    </div>
  );
}
