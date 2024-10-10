import { CSSProperties } from "react";

export default function NoScaledImpact({
  noStyle = false,
  style,
}: {
  noStyle?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="no-scaled-impact" style={style}>
      <div>
        <div
          className="font-weight-normal main-text"
          style={noStyle ? {} : { fontSize: "10.5px", lineHeight: "14px" }}
        >
          No scaled impact for this metric type
        </div>
      </div>
    </div>
  );
}
