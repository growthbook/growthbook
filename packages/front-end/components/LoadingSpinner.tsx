import React from "react";
import { FaSpinner } from "react-icons/fa";
import styles from "./LoadingSpinner.module.scss";
import clsx from "clsx";

export default function LoadingSpinner({...otherProps}): React.ReactElement {
  let className = clsx(styles.spin, otherProps.className);
  return <FaSpinner className={className} />;
}
