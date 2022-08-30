import React from "react";
import { FaSpinner } from "react-icons/fa";
import styles from "./LoadingSpinner.module.scss";

export default function LoadingSpinner(): React.ReactElement {
  return <FaSpinner className={`${styles.spin}`} />;
}
