import React from "react";
import clsx from "clsx";
import styles from "./TableContainer.module.scss";

interface TableContainerProps {
  children: React.ReactNode;
  className?: string;
  variant?: "standard" | "appbox";
}

export function TableContainer({
  children,
  className,
  variant = "standard",
}: TableContainerProps) {
  return (
    <div
      className={clsx(
        styles.container,
        variant === "appbox" && styles.appbox,
        className
      )}
    >
      {children}
    </div>
  );
}
