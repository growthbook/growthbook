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
import {
  SidebarItemLook,
  SidebarMenuInPlace,
  sidebarMenuTriggerProps,
} from "./SidebarMenu";
import { useMenuTriggerTooltip } from "./SidebarTooltip";
import { useIsTruncated } from "./useIsTruncated";
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
  const [labelEl, setLabelEl] = useState<HTMLSpanElement | null>(null);
  const truncated = useIsTruncated(labelEl, name);

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
      {/* The badge follows the name, as Beta does a page's. */}
      <span className={styles.nameWithBadge}>
        <span ref={setLabelEl} className={sidebarItem.labelClassName}>
          {name}
        </span>
        {current && isDemo(current.id) ? <DemoBadge /> : null}
      </span>
      {tooltip.anchor}
    </>
  );
  const expanded = !collapsed && styles.expanded;

  if (heldToOneProject) {
    return (
      <div className={clsx(sidebarItem.className, expanded, styles.static)}>
        <VisuallyHidden>Project: </VisuallyHidden>
        {collapsed ? <VisuallyHidden>{name}</VisuallyHidden> : null}
        {contents}
      </div>
    );
  }

  const trigger = (
    <button
      ref={triggerRef}
      {...sidebarMenuTriggerProps({
        look: sidebarItem,
        // Back in the drawer, focus returns to it from the menu (Sidebar.tsx).
        menu: inPlace ? "project" : undefined,
        label: `Project: ${name}`,
        className: expanded,
        open,
        inPlace,
        tooltip,
      })}
    >
      {contents}
    </button>
  );

  if (inPlace) {
    return (
      <>
        {trigger}
        {inPlace.open ? <ProjectMenuInPlace inPlace={inPlace} /> : null}
      </>
    );
  }

  return (
    <ProjectMenu
      open={open}
      onOpenChange={setOpen}
      anchorRef={triggerRef}
      trigger={trigger}
    />
  );
}
