import { ComponentPropsWithoutRef, forwardRef, ReactNode } from "react";
import clsx from "clsx";
import { SettingsPageTop } from "./SettingsJumpMenu";
import styles from "./PageFrame.module.scss";

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

export const PageBleed = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function PageBleed({ className, ...props }, ref) {
  return <div ref={ref} className={clsx(styles.bleed, className)} {...props} />;
});
