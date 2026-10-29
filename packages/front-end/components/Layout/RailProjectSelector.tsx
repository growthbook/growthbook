import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { VisuallyHidden } from "@radix-ui/themes";
import LetterAvatar from "./LetterAvatar";
import {
  DemoBadge,
  ProjectMenu,
  ProjectMenuInPlace,
  useProjectSelector,
} from "./ProjectSelector";
import { RailMenuInPlace } from "./railMenu";
import { useMenuTriggerTooltip } from "./railTooltips";
import styles from "./AppRail.module.scss";

// The project selector in the side nav: a row under the logo with the
// project's avatar (main's, "ALL" for All Projects) and its name, opening
// the project menu to the side nav's right. Collapsed, the avatar alone in
// the same place, its name in a tooltip. In the drawer (below 1180px), the
// same row, its menu drawn in the drawer's place (ProjectMenuInPlace).
export default function RailProjectSelector({
  collapsed,
  inPlace,
}: {
  collapsed: boolean;
  inPlace?: RailMenuInPlace;
}) {
  const { projects, current, heldToOneProject, isDemo, name } =
    useProjectSelector();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [collapsed]);

  // Expanded, a name cut off by the row shows in full in its tooltip, as it
  // always does collapsed.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const el = labelRef.current;
    if (!el) {
      setTruncated(false);
      return;
    }
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsed, name]);

  const tooltip = useMenuTriggerTooltip({
    label: name,
    enabled: collapsed || truncated,
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
      <span ref={labelRef} className={styles.rowLabel}>
        {name}
      </span>
      {current && isDemo(current.id) ? <DemoBadge /> : null}
      {tooltip.anchor}
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

  if (inPlace) {
    return (
      <>
        <button
          type="button"
          className={clsx(className, inPlace.open && styles.menuOpen)}
          aria-label={`Project: ${name}`}
          aria-expanded={inPlace.open}
          // Where focus goes back to from the menu (AppRail.tsx).
          data-rail-menu-trigger="project"
          onClick={(e) => inPlace.onOpen(e.detail === 0)}
          {...tooltip.triggerProps}
        >
          {contents}
        </button>
        {inPlace.open ? <ProjectMenuInPlace inPlace={inPlace} /> : null}
      </>
    );
  }

  return (
    <ProjectMenu
      open={open}
      onOpenChange={setOpen}
      menuSide="right"
      // Clear of the side nav's edge (the item sits 8px inside it).
      menuSideOffset={16}
      alignFirstRow
      anchorRef={triggerRef}
      trigger={
        <button
          ref={triggerRef}
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
