import { CSSProperties } from "react";

export default function NoScaledImpact({
  noStyle = false,
  style,
  message = "No scaled impact for this metric type",
}: {
  noStyle?: boolean;
  style?: CSSProperties;
  message?: string;
}) {
  return (
    <div className="no-scaled-impact" style={style}>
      <div>
        <div
          className="font-weight-normal main-text"
          style={noStyle ? {} : { fontSize: "10.5px", lineHeight: "14px" }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
