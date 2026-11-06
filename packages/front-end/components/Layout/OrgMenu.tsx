import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { VisuallyHidden } from "@radix-ui/themes";
import { PiBuildings } from "react-icons/pi";
import { DropdownMenu } from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import { withOpticalWeight } from "./opticalWeight";
import { useMenuTriggerTooltip } from "./SidebarTooltip";
import { TruncatedName } from "./ProjectMenu";
import {
  DropdownEntries,
  InPlaceMenu,
  SIDEBAR_ICON_SIZE,
  SidebarItemLook,
  SidebarMenuEntry,
  SidebarMenuInPlace,
} from "./SidebarMenu";
import {
  useSwitchOrganization,
  useUserOrganizations,
} from "./useUserOrganizations";
import { useIsTruncated } from "./useIsTruncated";
import styles from "./OrgMenu.module.scss";

const OrgIcon = withOpticalWeight(PiBuildings);

/** The side nav's organization switcher, for members of more than one. */
export default function OrgMenu({
  sidebarItem,
  inPlace,
}: {
  sidebarItem: SidebarItemLook;
  /** In the drawer, the menu is drawn in place (Sidebar.tsx). */
  inPlace?: SidebarMenuInPlace;
}) {
  const { collapsed } = sidebarItem;
  const { organization } = useUser();
  const organizations = useUserOrganizations();
  const { currentOrgId, switchOrg } = useSwitchOrganization();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [collapsed]);

  const name =
    organizations.find((o) => o.id === currentOrgId)?.name ??
    organization.name ??
    "";
  const [labelEl, setLabelEl] = useState<HTMLSpanElement | null>(null);
  const truncated = useIsTruncated(labelEl, name);
  const tooltip = useMenuTriggerTooltip({
    label: name,
    enabled: collapsed || truncated,
    menuOpen: open || !!inPlace?.open,
  });

  if (organizations.length < 2) return null;

  const entries: SidebarMenuEntry[] = [
    { type: "label", key: "header", label: "Organizations" },
    ...organizations.map((o): SidebarMenuEntry => {
      const current = o.id === currentOrgId;
      return {
        type: "item",
        key: o.id,
        onSelect: () => {
          setOpen(false);
          if (current) {
            inPlace?.onBack(false);
            return;
          }
          // In the drawer, switching closes it, as choosing an item does.
          inPlace?.onDone();
          switchOrg(o.id);
        },
        content: (
          // The current one is bold, as in the project menu.
          <span className={styles.option}>
            <TruncatedName name={o.name} current={current} />
            {current ? <VisuallyHidden> (current)</VisuallyHidden> : null}
          </span>
        ),
      };
    }),
  ];

  const trigger = (
    <button
      type="button"
      className={clsx(
        sidebarItem.className,
        (open || inPlace?.open) && sidebarItem.openClassName,
      )}
      aria-label={`Organization: ${name}`}
      // Focus returns here from the drawer's menu (Sidebar.tsx).
      data-sidebar-menu-trigger="organization"
      {...tooltip.triggerProps}
      {...(inPlace
        ? {
            "aria-expanded": inPlace.open,
            onClick: (e: React.MouseEvent) => inPlace.onOpen(e.detail === 0),
          }
        : {})}
    >
      <OrgIcon
        size={SIDEBAR_ICON_SIZE}
        className={sidebarItem.iconClassName}
        aria-hidden="true"
      />
      {collapsed ? null : (
        <span ref={setLabelEl} className={sidebarItem.labelClassName}>
          {name}
        </span>
      )}
      {tooltip.anchor}
    </button>
  );

  if (inPlace) {
    return (
      <>
        {trigger}
        {inPlace.open && inPlace.host
          ? createPortal(
              <InPlaceMenu
                label="Organizations"
                entries={entries}
                inPlace={inPlace}
              />,
              inPlace.host,
            )
          : null}
      </>
    );
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      menuPlacement="start"
      menuSide="right"
      // 8px past the sidebar's edge: the item sits 8px inside it.
      menuSideOffset={16}
      // Room for a long name before it truncates.
      menuWidth={280}
      variant="soft"
      trigger={trigger}
    >
      <div className={styles.list}>
        <DropdownEntries entries={entries} />
      </div>
    </DropdownMenu>
  );
}
