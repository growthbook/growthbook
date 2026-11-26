import React from "react";
import clsx from "clsx";
import { useLingui } from "@lingui/react/macro";
import LoadingSpinner from "./LoadingSpinner";
import styles from "./LoadingOverlay.module.scss";

export default function LoadingOverlay({
  text,
  relativePosition = false,
}: {
  text?: string;
  relativePosition?: boolean;
}): React.ReactElement {
  const { t } = useLingui();
  const loadingText = text === undefined ? t`Loading...` : text;
  const overlayClasses = clsx(styles.overlay, {
    relativePositionOverlay: relativePosition,
  });
  const overlayTextClasses = clsx(styles.text, {
    relativePositionOverlayText: relativePosition,
  });
  return (
    <div className={overlayClasses}>
      <div className={overlayTextClasses}>
        <LoadingSpinner /> {loadingText}
      </div>
    </div>
  );
}
