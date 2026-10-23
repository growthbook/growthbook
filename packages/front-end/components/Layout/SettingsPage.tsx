import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import PageHead from "./PageHead";
import styles from "./SettingsPage.module.scss";

/** Shell for Settings pages: breadcrumb, title block, and an optional actions slot. */
export default function SettingsPage({
  title,
  description,
  actions,
  breadcrumb,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Defaults to Settings / Organization / title. */
  breadcrumb?: BreadcrumbItem[];
  children: ReactNode;
}) {
  return (
    <>
      <PageHead
        breadcrumb={
          breadcrumb ?? [
            { display: "Settings" },
            { display: "Organization" },
            { display: title },
          ]
        }
      />
      <Box className="container-fluid pagecontents" mb="4">
        <Flex justify="between" align="start" gap="4" wrap="wrap" mb="4">
          <Box>
            <h1 className={styles.title}>{title}</h1>
            {description && <p className={styles.description}>{description}</p>}
          </Box>
          {actions && (
            <Flex gap="2" align="center">
              {actions}
            </Flex>
          )}
        </Flex>
        {children}
      </Box>
    </>
  );
}
