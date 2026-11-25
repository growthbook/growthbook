import { CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";

export default function NoScaledImpact({
  noStyle = false,
  style,
  message,
}: {
  noStyle?: boolean;
  style?: CSSProperties;
  message?: string;
}) {
  const { t } = useLingui();
  const messageText =
    message === undefined ? t`No scaled impact for this metric type` : message;
  return (
    <div className="no-scaled-impact" style={style}>
      <div>
        <div
          className="font-weight-normal main-text"
          style={noStyle ? {} : { fontSize: "10.5px", lineHeight: "14px" }}
        >
          {messageText}
        </div>
      </div>
    </div>
  );
}
