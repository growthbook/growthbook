import React from "react";
import styles from "./ResponsiveTable.module.scss";

interface ResponsiveTableProps {
  children: React.ReactNode;
  mobileDataTitles?: Record<number, string>; // column index to mobile label
  className?: string;
}

export function ResponsiveTable({
  children,
  mobileDataTitles = {},
  className,
}: ResponsiveTableProps) {
  // Clone children and inject data-mobile-label attributes
  // Note: This is a simplified approach. In practice, you may need to
  // recursively traverse the tree to find TableCell components and inject
  // the data-mobile-label based on column index. For now, users can manually
  // add data-mobile-label to TableCell components.

  return (
    <div className={`${styles.responsiveTable} ${className || ""}`}>
      {children}
    </div>
  );
}
