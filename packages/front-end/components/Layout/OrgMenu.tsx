import { useEffect, useState } from "react";
import { VisuallyHidden } from "@radix-ui/themes";
import { PiBuildings } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { withOpticalWeight } from "./opticalWeight";
import { useMenuTriggerTooltip } from "./SidebarTooltip";
import { TruncatedName } from "./ProjectMenu";
import {
  SIDEBAR_ICON_SIZE,
  SidebarItemLook,
  SidebarItemMenu,
  SidebarMenuEntry,
  SidebarMenuInPlace,
  sidebarMenuTriggerProps,
} from "./SidebarMenu";
import {
  useSwitchOrganization,
  useUserOrganizations,
} from "./useUserOrganizations";
import { useIsTruncated } from "./useIsTruncated";
import styles from "./OrgMenu.module.scss";

const OrgIcon = withOpticalWeight(PiBuildings);
/**
 * Raises the menu so its first organization is level with the trigger, as the
 * project menu's first row is: the menu's 8px top padding plus its heading's
 * 28px (SidebarMenu.module.scss's .dropdownLabel: 8 + 14 + 6).
 */
const MENU_FIRST_ROW_OFFSET = 8 + 28;

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
          // In the drawer, the menu closes it after any choice (InPlaceMenu).
          if (!current) switchOrg(o.id);
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
      {...sidebarMenuTriggerProps({
        look: sidebarItem,
        menu: "organization",
        label: `Organization: ${name}`,
        open,
        inPlace,
        tooltip,
      })}
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

  return (
    <SidebarItemMenu
      trigger={trigger}
      heading="Organizations"
      entries={entries}
      inPlace={inPlace}
      open={open}
      onOpenChange={setOpen}
      placement="start"
      alignOffset={-MENU_FIRST_ROW_OFFSET}
      // Room for a long name before it truncates.
      width={280}
      listClassName={styles.list}
    />
  );
}
