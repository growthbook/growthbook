import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { VisuallyHidden } from "@radix-ui/themes";
import LetterAvatar from "./LetterAvatar";
import {
  DemoBadge,
  ProjectMenu,
  ProjectMenuInPlace,
  useProjectSelector,
} from "./ProjectMenu";
import { SidebarItemLook, SidebarMenuInPlace } from "./SidebarMenu";
import { useMenuTriggerTooltip } from "./SidebarTooltip";
import styles from "./SidebarProjectSelector.module.scss";

export default function SidebarProjectSelector({
  sidebarItem,
  inPlace,
}: {
  sidebarItem: SidebarItemLook;
  inPlace?: SidebarMenuInPlace;
}) {
  const { collapsed } = sidebarItem;
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
    <span className={styles.avatar} aria-hidden="true">
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
      <span ref={labelRef} className={sidebarItem.labelClassName}>
        {name}
      </span>
      {current && isDemo(current.id) ? <DemoBadge /> : null}
      {tooltip.anchor}
    </>
  );
  const className = clsx(sidebarItem.className, !collapsed && styles.expanded);

  if (heldToOneProject) {
    return (
      <div className={clsx(className, styles.static)}>
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
          className={clsx(className, inPlace.open && sidebarItem.openClassName)}
          aria-label={`Project: ${name}`}
          aria-expanded={inPlace.open}
          // Focus returns here from the menu (Sidebar.tsx).
          data-sidebar-menu-trigger="project"
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
          className={clsx(className, open && sidebarItem.openClassName)}
          aria-label={`Project: ${name}`}
          {...tooltip.triggerProps}
        >
          {contents}
        </button>
      }
    />
  );
}
