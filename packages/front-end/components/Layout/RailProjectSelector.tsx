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

  // A truncated name gets a tooltip, as the collapsed avatar always does.
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

  if (!projects.length) return null;

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
          // Focus returns here from the menu (AppRail.tsx).
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
