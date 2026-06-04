import React from "react";
import { FaSpinner } from "react-icons/fa";
import clsx from "clsx";
import styles from "./LoadingSpinner.module.scss";

export default function LoadingSpinner({
  className,
  ...otherProps
}: React.ComponentProps<typeof FaSpinner>): React.ReactElement {
  return <FaSpinner className={clsx(styles.spin, className)} {...otherProps} />;
}
