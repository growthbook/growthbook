import { useEffect, useState } from "react";
import clsx from "clsx";
import { VisuallyHidden } from "@radix-ui/themes";
import LetterAvatar from "./LetterAvatar";
import { DemoBadge, ProjectMenu, useProjectSelector } from "./ProjectSelector";
import { useMenuTriggerTooltip } from "./railTooltips";
import styles from "./AppRail.module.scss";

// The project selector in the side nav, from 1180px up: a row under the logo
// with the project's avatar (main's, "ALL" for All Projects) and its name,
// opening the project menu to the side nav's right.
// Collapsed, the avatar alone in the same place, its name in a tooltip.
// Below 1180px it's in the header breadcrumb instead (ProjectSelector).
export default function RailProjectSelector({
  collapsed,
}: {
  collapsed: boolean;
}) {
  const { projects, current, heldToOneProject, isDemo, name } =
    useProjectSelector();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [collapsed]);

  const tooltip = useMenuTriggerTooltip({
    label: name,
    enabled: collapsed,
    menuOpen: open,
  });

  // As main's: nothing to pick from, no selector.
  if (!projects.length) return null;

  // Its own 8px right margin taken back, so it centers in the collapsed
  // icon's box and sits on the icon column expanded.
  const avatar = (
    <span className={styles.projectAvatar} aria-hidden="true">
      <LetterAvatar
        name={current?.name ?? ""}
        defaultInitials="ALL"
        size="small"
      />
    </span>
  );
  const contents = collapsed ? (
    <>
      {avatar}
      {tooltip.anchor}
    </>
  ) : (
    <>
      {avatar}
      <span className={styles.rowLabel}>{name}</span>
      {current && isDemo(current.id) ? <DemoBadge /> : null}
    </>
  );
  const className = clsx(
    collapsed ? styles.iconItem : styles.row,
    styles.projectItem,
  );

  // Held to one project: its name, with no menu to open.
  if (heldToOneProject) {
    return (
      <div className={clsx(className, styles.projectStatic)}>
        <VisuallyHidden>Project: </VisuallyHidden>
        {collapsed ? <VisuallyHidden>{name}</VisuallyHidden> : null}
        {contents}
      </div>
    );
  }

  return (
    <ProjectMenu
      open={open}
      onOpenChange={setOpen}
      avatars
      menuSide="right"
      // Clear of the side nav's edge (the item sits 8px inside it).
      menuSideOffset={16}
      trigger={
        <button
          type="button"
          className={clsx(className, open && styles.menuShowing)}
          aria-label={`Project: ${name}`}
          {...tooltip.triggerProps}
        >
          {contents}
        </button>
      }
    />
  );
}
