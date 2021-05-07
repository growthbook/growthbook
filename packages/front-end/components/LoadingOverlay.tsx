import React from "react";
import LoadingSpinner from "./LoadingSpinner";
import styles from "./LoadingOverlay.module.scss";

export default function LoadingOverlay(): React.ReactElement {
  return (
    <div className={styles.overlay}>
      <div className={styles.text}>
        <LoadingSpinner /> Loading...
      </div>
    </div>
  );
}
