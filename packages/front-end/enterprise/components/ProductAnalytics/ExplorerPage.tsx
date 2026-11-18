import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import clsx from "clsx";
import { DatasetType } from "shared/validators";
import PageHead from "@/components/Layout/PageHead";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import Explorer from "./Explorer";
import styles from "./ExplorerPage.module.scss";

export default function ExplorerPage({
  type,
  breadcrumb,
  children,
}: {
  type: DatasetType;
  breadcrumb: BreadcrumbItem[];
  // Shown above the explorer.
  children?: ReactNode;
}) {
  return (
    <Box className={clsx(styles.page, type === "sql" && styles.sql)}>
      <PageHead breadcrumb={breadcrumb} />
      <Box width="100%">
        {children}
        <Explorer type={type} />
      </Box>
    </Box>
  );
}
