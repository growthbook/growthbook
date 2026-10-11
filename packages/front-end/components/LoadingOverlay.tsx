import React from "react";
import clsx from "clsx";
import LoadingSpinner from "./LoadingSpinner";
import styles from "./LoadingOverlay.module.scss";

export default function LoadingOverlay({
  text = "Loading...",
  relativePosition = false,
}: {
  text?: string;
  relativePosition?: boolean;
}): React.ReactElement {
  const overlayClasses = clsx(styles.overlay, {
    relativePositionOverlay: relativePosition,
  });
  const overlayTextClasses = clsx(styles.text, {
    relativePositionOverlayText: relativePosition,
  });
  return (
    // data-loading-overlay: lets the page transition wait for a new page
    // to finish loading before revealing it (_app.tsx).
    <div className={overlayClasses} data-loading-overlay="">
      <div className={overlayTextClasses}>
        <LoadingSpinner /> {text}
      </div>
    </div>
  );
}
