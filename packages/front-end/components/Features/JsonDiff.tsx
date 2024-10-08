import { CSSProperties } from "react";
import ReactJsonViewCompare from "react-json-view-compare";

function fixJsonRecursive(obj) {
  if (typeof obj != "string" && typeof obj != "object") {
    return obj;
  }
  if (typeof obj == "string") {
    let jsonObj;
    try {
      jsonObj = JSON.parse(obj);
    } catch (e) {
      return obj;
    }
    obj = jsonObj;
  }

  for (const key in obj) {
    obj[key] = fixJsonRecursive(obj[key]);
  }
  return obj;
}

export default function JsonDiff({
  value,
  defaultVal = "{}",
  fullStyle = { maxHeight: 300, overflowY: "auto", maxWidth: "100%" },
}: {
  value: string;
  defaultVal?: string;
  fullStyle?: CSSProperties;
}) {
  let oldData = JSON.parse(defaultVal);
  oldData = fixJsonRecursive(oldData);
  let newData = JSON.parse(value);
  newData = fixJsonRecursive(newData);

  return (
    <div style={fullStyle}>
      <ReactJsonViewCompare oldData={oldData} newData={newData} />
    </div>
  );
}
