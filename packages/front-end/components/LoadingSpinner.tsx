import React from "react";
import { FaSpinner } from "react-icons/fa";
import clsx from "clsx";
import styles from "./LoadingSpinner.module.scss";

export default function LoadingSpinner({ ...otherProps }): React.ReactElement {
  const className = clsx(styles.spin, otherProps.className);
  return <FaSpinner className={className} />;
}
