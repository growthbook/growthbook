import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/router";
import clsx from "clsx";
import { IconType } from "react-icons";
import {
  PiBuildingBold,
  PiCircleHalf,
  PiFileText,
  PiHourglassHigh,
  PiKey,
  PiListChecks,
  PiMoon,
  PiPlus,
  PiSignOut,
  PiSlackLogo,
  PiSunDim,
  PiUserCircle,
} from "react-icons/pi";
import { DropdownMenu } from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import {
  allowSelfOrgCreation,
  isCloud,
  isMultiOrg,
  showMultiOrgSelfSelector,
} from "@/services/env";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useOpenRevisionCount } from "@/hooks/useRevisions";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import EditProfileModal from "./EditProfileModal";
import {
  usePrototypeOrgs,
  usePrototypePendingReviews,
} from "./PrototypeControls";
import { withOpticalWeight } from "./opticalWeight";
import { BOTTOM_TOOLTIP_DELAY_MS } from "./railTooltips";
import railTooltipStyles from "./AppRail.module.scss";
import styles from "./ProfileMenu.module.scss";
import {
  DropdownEntries,
  InPlaceMenu,
  RailMenuEntry,
  RailMenuInPlace,
} from "./railMenu";

// The side nav's user circle, thickened (opticalWeight.tsx; set in review).
const ProfileIcon = withOpticalWeight(PiUserCircle);

// PROTOTYPE (set in review): with "Multiple organizations" set to Several
// orgs in the prototype settings (PrototypeControls.tsx), the menu acts as
// if the user is in several organizations: the current one plus these
// made-up ones, 5 at most, in the organization selector. Choosing a made-up
// one only changes what the menu shows.
const PROTOTYPE_DEMO_ORGS = [
  { id: "prototype-org-1", name: "Acme Corp" },
  { id: "prototype-org-2", name: "Globex Analytics" },
  { id: "prototype-org-3", name: "Initech" },
  { id: "prototype-org-4", name: "Umbrella Labs" },
];
// The selector lists 5 organizations at most (prototype).
const MAX_SELECTOR_ORGS = 5;
// The selector's Add organization item, after its organizations.
const ADD_ORG_VALUE = "__add-organization__";

// These icons' lines 0.2px thicker at 18px, as some of the side nav's
// (opticalWeight.tsx; set in review): their outlines read lighter than the
// others.
const SunDimIcon = withOpticalWeight(PiSunDim);
const ActivityIcon = withOpticalWeight(PiListChecks);
const TokenIcon = withOpticalWeight(PiKey);
const SignOutIcon = withOpticalWeight(PiSignOut);

const THEME_LABELS = { system: "System", light: "Light", dark: "Dark" };
const THEME_ICONS: Record<keyof typeof THEME_LABELS, IconType> = {
  system: PiCircleHalf,
  light: SunDimIcon,
  dark: PiMoon,
};

// The user's organizations, with the current one added for a superAdmin who
// picked it from /admin (it isn't in their list), as TopNav did.
export function useUserOrganizations() {
  const { organization } = useUser();
  const { organizations } = useAuth();
  const list = organizations ? [...organizations] : [];
  if (
    organization.id &&
    organization.name &&
    !list.some((o) => o.id === organization.id)
  ) {
    list.push({ id: organization.id, name: organization.name });
  }
  return list;
}

function MenuItemContent({
  Icon,
  label,
  trailing,
}: {
  Icon: IconType;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <span className={styles.itemContent}>
      <Icon size={18} className={styles.itemIcon} aria-hidden="true" />
      <span className={styles.itemLabel}>{label}</span>
      {trailing}
    </span>
  );
}

// The account menu, opened from the header's avatar (app header redesign):
// the identity row (opens Edit Profile), a read-only org line, then the
// existing items regrouped, each with an icon. Switch organization for
// users in more than one org. The avatar carries a red dot while there are
// pending reviews (the Pending Reviews count). In the narrow drawer
// (inPlace; set in review), the same items open in place of the nav instead
// of a popover (railMenu.tsx).
export default function ProfileMenu({
  railCollapsed,
  railClassName,
  railOpenClassName,
  railLabelClassName,
  railIconSize = 20,
  railIconClassName,
  inPlace,
}: {
  // Opt-in: shown as a side nav item (set in review; was the header's
  // avatar). Collapsed, the avatar alone; expanded, the avatar and the name.
  // The classes are the side nav's item styles.
  railCollapsed?: boolean;
  railClassName?: string;
  railOpenClassName?: string;
  railLabelClassName?: string;
  // In the side nav, a profile icon in place of the avatar (set in review),
  // at the rail's icon size, with the rail's icon class when expanded.
  railIconSize?: number;
  railIconClassName?: string;
  // Opt-in: in the narrow drawer, its menu drawn in place (AppRail.tsx).
  inPlace?: RailMenuInPlace;
} = {}) {
  const inRail = railCollapsed !== undefined;
  const router = useRouter();
  const { name, email, organization, hasCommercialFeature } = useUser();
  const { logout, orgId, setOrgId } = useAuth();
  const { setTheme, preferredTheme } = useAppearanceUITheme();
  const organizations = useUserOrganizations();

  const [open, setOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const hasApprovalFlows = hasCommercialFeature("require-approvals");
  // Lightweight count endpoint, filtered server-side to open revisions.
  const { count: openRevisionCount } = useOpenRevisionCount();
  // PROTOTYPE (set in review): the prototype panel's "Pending reviews" can
  // override the count (null: the real one), for the avatar's red dot and
  // Pending Reviews, which then shows with or without approval flows.
  const pendingReviewsOverride = usePrototypePendingReviews();
  const showPendingReviews =
    hasApprovalFlows || pendingReviewsOverride !== null;
  const pendingReviewCount =
    pendingReviewsOverride ?? (hasApprovalFlows ? openRevisionCount : 0);

  // PROTOTYPE: the prototype settings' "Multiple organizations" (null: the
  // real case). One org can't add one; One org + can add can.
  const prototypeOrgs = usePrototypeOrgs();
  const canAddOrganization =
    prototypeOrgs === "one-can-add" ||
    (prototypeOrgs !== "one" &&
      !isCloud() &&
      isMultiOrg() &&
      (showMultiOrgSelfSelector() || allowSelfOrgCreation()));
  // The organizations in the selector: the user's own, or with the
  // prototype setting on, the current one and made-up ones.
  const currentOrg = {
    id: orgId ?? organization.id ?? "",
    name:
      organizations.find((o) => o.id === orgId)?.name ??
      organization.name ??
      "",
  };
  const selectorOrgs = (
    prototypeOrgs === "several" && organizations.length <= 1
      ? [currentOrg, ...PROTOTYPE_DEMO_ORGS]
      : organizations.length > 0
        ? organizations
        : [currentOrg]
  ).slice(0, MAX_SELECTOR_ORGS);
  // As main: the selector for more than one organization, or when they can
  // add one.
  const showOrgSelector = selectorOrgs.length > 1 || canAddOrganization;
  // A made-up organization chosen in the prototype: shown, not switched to.
  const [prototypeOrgId, setPrototypeOrgId] = useState<string | null>(null);
  const shownOrgId = prototypeOrgId ?? currentOrg.id;
  const orgName =
    selectorOrgs.find((o) => o.id === shownOrgId)?.name ?? currentOrg.name;

  const chooseOrg = (id: string) => {
    if (id === ADD_ORG_VALUE) {
      inPlace?.onDone();
      go("/settings/organizations");
      return;
    }
    if (id === shownOrgId) return;
    const real = organizations.some((o) => o.id === id);
    if (!real) {
      setPrototypeOrgId(id);
      return;
    }
    setPrototypeOrgId(null);
    setOpen(false);
    // In the drawer, switching closes it, as choosing an item does.
    inPlace?.onDone();
    if (!setOrgId) return;
    setOrgId(id);
    try {
      localStorage.setItem("gb-last-picked-org", `"${id}"`);
    } catch (e) {
      // Storage blocked: the switch still happens.
    }
  };

  // As the side nav's section menus: the list column menu's shadow and
  // outline (see .menu).
  const menuClassName = clsx(
    styles.menu,
    listTableStyles.menuShadow,
    listTableStyles.menuOutline,
  );

  const go = (href: string) => {
    setOpen(false);
    void router.push(href);
  };
  const themeKey = (preferredTheme ?? "system") as keyof typeof THEME_LABELS;
  const ThemeIcon = THEME_ICONS[themeKey] ?? PiCircleHalf;

  const accountLabel = [
    // "Profile" in the side nav, as its name and tooltip (set in review).
    inRail ? "Profile" : "Account menu",
    // In the expanded side nav the name shows, so it leads the label.
    inRail ? name : null,
    email,
    pendingReviewCount > 0
      ? `${pendingReviewCount} pending review${pendingReviewCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  const item = (
    key: string,
    content: React.ReactNode,
    onSelect: () => void,
  ): RailMenuEntry => ({ type: "item", key, content, onSelect });
  const themeKeys = Object.keys(THEME_LABELS) as (keyof typeof THEME_LABELS)[];
  const entries: RailMenuEntry[] = [
    {
      // The identity row: one target, opening Edit Profile.
      type: "item",
      key: "identity",
      className: styles.identity,
      onSelect: () => {
        setOpen(false);
        setEditProfileOpen(true);
      },
      content: (
        <span className={styles.identityContent}>
          <span className="sr-only">Edit profile: </span>
          {/* At lg (40px; the design has 36px), in the light purple
            (violet, soft; set in review; was grey). */}
          <UserAvatar
            name={name || ""}
            email={email || ""}
            size="lg"
            color="violet"
            variant="soft"
          />
          <span className={styles.identityText}>
            {name ? <span className={styles.identityName}>{name}</span> : null}
            <span className={styles.identityEmail}>{email}</span>
            {/* The org, under the email inside the identity row, so the
              row's hover covers it too (set in review; was a separate,
              read-only line below the row). Only for one organization:
              with several, the selector below shows it instead (set in
              review). */}
            {orgName && !showOrgSelector ? (
              <span className={styles.orgLine}>
                {/* Phosphor's building, bold (set in review; was
                  buildings; tried filled, and regular). */}
                <PiBuildingBold size={13} aria-hidden="true" />
                <span className={styles.orgName}>{orgName}</span>
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    // The organization selector, for users in more than one org: below the
    // identity row and separate from it, a small single select of the org
    // names (set in review; was a Switch organization submenu). Add
    // organization below it, where allowed.
    ...(showOrgSelector
      ? [
          {
            type: "node" as const,
            key: "org-selector",
            node: (
              <div
                className={styles.orgSelector}
                role="group"
                aria-label="Organization"
              >
                {/* Medium (set in review; was small). The closed field shows the
                  building icon, bold, before the org's name (set in review). */}
                <Select
                  size="md"
                  value={shownOrgId}
                  setValue={chooseOrg}
                  triggerClassName={styles.orgSelectorTrigger}
                  // Its list with the side nav menus' shadow and 1px outline (the
                  // list column menu's), their hover, and Phosphor's check (set in
                  // review; .orgSelectorMenu).
                  contentClassName={clsx(
                    styles.orgSelectorMenu,
                    listTableStyles.menuShadow,
                    listTableStyles.menuOutline,
                  )}
                  valueLabel={
                    <span className={styles.orgSelectorValue}>
                      <PiBuildingBold
                        size={14}
                        className={styles.orgSelectorIcon}
                        aria-hidden="true"
                      />
                      <span className={styles.orgName}>{orgName}</span>
                    </span>
                  }
                >
                  {/* Add organization first, where allowed, then a
                    divider and the organizations (set in review; main has
                    it last). */}
                  {canAddOrganization ? (
                    <>
                      <SelectItem value={ADD_ORG_VALUE}>
                        <span className={styles.addOrgItem}>
                          <MenuItemContent
                            Icon={PiPlus}
                            label="Add Organization"
                          />
                        </span>
                      </SelectItem>
                      <SelectSeparator />
                    </>
                  ) : null}
                  {selectorOrgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            ),
          },
        ]
      : []),
    { type: "separator", key: "sep-1" },
    ...(showPendingReviews
      ? [
          item(
            "reviews",
            <MenuItemContent
              Icon={PiHourglassHigh}
              label="Pending Reviews"
              trailing={
                pendingReviewCount > 0 ? (
                  <span className={styles.countBadge}>
                    {pendingReviewCount}
                  </span>
                ) : null
              }
            />,
            () => go("/approval-requests"),
          ),
        ]
      : []),
    item(
      "activity",
      <MenuItemContent Icon={ActivityIcon} label="Activity Feed" />,
      () => go("/activity"),
    ),
    item(
      "reports",
      <MenuItemContent Icon={PiFileText} label="My Reports" />,
      () => go("/reports"),
    ),
    { type: "separator", key: "sep-2" },
    item(
      "tokens",
      <MenuItemContent Icon={TokenIcon} label="Personal Access Tokens" />,
      () => go("/account/personal-access-tokens"),
    ),
    item(
      "slack",
      <MenuItemContent Icon={PiSlackLogo} label="My Slack links" />,
      () => go("/account/slack"),
    ),
    {
      type: "submenu",
      key: "theme",
      label: "Theme",
      contentClassName: menuClassName,
      trigger: (
        <MenuItemContent
          Icon={ThemeIcon}
          label="Theme"
          trailing={
            <span className={styles.themeValue}>
              {THEME_LABELS[themeKey] ?? "System"}
            </span>
          }
        />
      ),
      entries: themeKeys.map((key) =>
        item(
          `theme-${key}`,
          <MenuItemContent
            Icon={THEME_ICONS[key]}
            label={key === "system" ? "System Default" : THEME_LABELS[key]}
          />,
          () => {
            setOpen(false);
            setTheme(key);
          },
        ),
      ),
    },
    { type: "separator", key: "sep-3" },
    item(
      "sign-out",
      <MenuItemContent Icon={SignOutIcon} label="Sign Out" />,
      () => logout(),
    ),
  ];

  const triggerButton = (
    onOpenInPlace?: (fromKeyboard: boolean) => void,
  ): React.ReactNode => (
    <button
      type="button"
      className={
        inRail
          ? clsx(
              railClassName,
              styles.railItem,
              (open || inPlace?.open) && railOpenClassName,
            )
          : clsx(styles.avatarButton, open && styles.avatarOpen)
      }
      aria-label={accountLabel}
      data-rail-menu-trigger="profile"
      {...(onOpenInPlace
        ? {
            "aria-expanded": !!inPlace?.open,
            onClick: (e: React.MouseEvent) => onOpenInPlace(e.detail === 0),
          }
        : {})}
    >
      {/* The product's avatar (@/ui/Avatar, via UserAvatar), violet and
        soft, its light purple (set in review; tried grey; was
        hand-built at 28px), at sm (24px; tried md, 32px). */}
      <span className={styles.avatarWrap}>
        {inRail ? (
          // Phosphor's user circle, as the rail's other icons (set in
          // review; was the avatar).
          <ProfileIcon
            size={railIconSize}
            className={railIconClassName}
            aria-hidden="true"
          />
        ) : (
          <UserAvatar
            name={name || ""}
            email={email || ""}
            size="sm"
            color="violet"
            variant="soft"
          />
        )}
        {pendingReviewCount > 0 ? (
          <span className={styles.reviewDot} aria-hidden="true" />
        ) : null}
      </span>
      {inRail && !railCollapsed ? (
        <span className={railLabelClassName}>{name || email || "Account"}</span>
      ) : null}
    </button>
  );

  const modals = (
    <>
      {editProfileOpen ? (
        <EditProfileModal close={() => setEditProfileOpen(false)} />
      ) : null}
    </>
  );

  if (inPlace) {
    return (
      <>
        {modals}
        {triggerButton(inPlace.onOpen)}
        {inPlace.open && inPlace.host
          ? createPortal(
              <InPlaceMenu
                label="Profile"
                entries={entries}
                itemClassName={styles.item}
                inPlace={inPlace}
              />,
              inPlace.host,
            )
          : null}
      </>
    );
  }

  return (
    <>
      {modals}
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        // In the side nav, it opens to the right, its bottom edge level with
        // the item's.
        menuPlacement="end"
        menuSide={inRail ? "right" : "bottom"}
        // 8px past the rail's edge, as its section menus (set in review):
        // the item sits 8px inside it.
        menuSideOffset={inRail ? 16 : undefined}
        // In the collapsed side nav, its name on hover, as the rail's other
        // icons (set in review).
        triggerTooltip={railCollapsed ? "Profile" : undefined}
        triggerTooltipSide="right"
        triggerTooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
        triggerTooltipClassName={railTooltipStyles.railTooltip}
        contentClassName={menuClassName}
        trigger={triggerButton()}
      >
        <DropdownEntries entries={entries} itemClassName={styles.item} />
      </DropdownMenu>
    </>
  );
}
