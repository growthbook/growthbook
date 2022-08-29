import React from "react";
import { FaSpinner } from "react-icons/fa";
import styles from "./LoadingSpinner.module.scss";

interface LoadingSpinnerProps {
  addMarginRight?: boolean;
}

export default function LoadingSpinner({
  addMarginRight = true,
}: LoadingSpinnerProps): React.ReactElement {
  return (
    <FaSpinner className={`${styles.spin} ${addMarginRight ? "mr-3" : ""}`} />
  );
}
