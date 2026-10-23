import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import PageHead from "./PageHead";
import styles from "./SettingsPage.module.scss";

/** Title block for a Settings page. Components that own the page's primary action render this themselves. */
export function SettingsPageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
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
  );
}

/** Shell for Settings pages: breadcrumb, container, and (unless `hideHeader`) the title block. */
export default function SettingsPage({
  title,
  description,
  actions,
  breadcrumb,
  hideHeader,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Defaults to Settings / Organization / title. */
  breadcrumb?: BreadcrumbItem[];
  /** When a child renders SettingsPageHeader itself. */
  hideHeader?: boolean;
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
        {!hideHeader && (
          <SettingsPageHeader
            title={title}
            description={description}
            actions={actions}
          />
        )}
        {children}
      </Box>
    </>
  );
}
