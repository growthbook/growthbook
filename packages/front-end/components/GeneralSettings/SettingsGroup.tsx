import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import { SettingsCard } from "./SettingsSection";
import styles from "./SettingsSection.module.scss";

/**
 * One card in a General settings section: title and description on the left,
 * fields on the right. Also the unit that search shows or hides.
 */
export function SettingsGroup({
  id,
  title,
  description,
  badge,
  keywords,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  badge?: string;
  keywords?: string;
  children: ReactNode;
}) {
  return (
    <SettingsCard id={id} keywords={keywords}>
      <div className={styles.group}>
        <div className={styles.groupIntro}>
          <Flex align="center" gap="2" wrap="wrap">
            <h3 className={styles.groupTitle}>{title}</h3>
            {badge && <Badge label={badge} color="gray" variant="soft" />}
          </Flex>
          {description && (
            <p className={styles.groupDescription}>{description}</p>
          )}
        </div>
        <Flex direction="column" gap="4" className={styles.groupFields}>
          {children}
        </Flex>
      </div>
    </SettingsCard>
  );
}

/** A labelled control inside a group: label, optional help, then the input. */
export function SettingsField({
  label,
  help,
  htmlFor,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Box>
      <label htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {help && <p className={styles.fieldHelp}>{help}</p>}
      {children}
    </Box>
  );
}

/** A smaller heading that splits fields within one group, like Bayesian vs Frequentist. */
export function SettingsSubheading({ children }: { children: ReactNode }) {
  return <h4 className={styles.subheading}>{children}</h4>;
}
