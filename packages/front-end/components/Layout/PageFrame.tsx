import { ComponentPropsWithoutRef, forwardRef, ReactNode } from "react";
import clsx from "clsx";
import { SettingsPageTop } from "./SettingsJumpMenu";
import styles from "./PageFrame.module.scss";

/**
 * Wraps every page but the full-window ones (noPageWrapper, _app.tsx) and
 * owns the page's spacing, so pages don't pad themselves.
 */
export default function PageFrame({
  settings,
  children,
}: {
  // A Settings page: it starts past the Settings nav, or under its select.
  settings: boolean;
  children: ReactNode;
}) {
  return (
    <div className={clsx(styles.frame, settings && styles.settings)}>
      {settings ? <SettingsPageTop /> : null}
      {children}
    </div>
  );
}

/**
 * A band inside the frame that runs to the page's edges (a tab row, a status
 * bar), its content still in line with the page.
 */
export const PageBleed = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function PageBleed({ className, ...props }, ref) {
  return <div ref={ref} className={clsx(styles.bleed, className)} {...props} />;
});
