import { ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/router";
import { IconButton, VisuallyHidden } from "@radix-ui/themes";
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
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
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
import EditProfileModal from "./EditProfileModal";
import { withOpticalWeight } from "./opticalWeight";
import { useMenuTriggerTooltip } from "./railTooltips";
import {
  DropdownEntries,
  InPlaceMenu,
  MenuItemContent,
  RailMenuEntry,
  RailMenuInPlace,
} from "./railMenu";
import { useUserOrganizations } from "./useUserOrganizations";
import styles from "./ProfileMenu.module.scss";

const ProfileIcon = withOpticalWeight(PiUserCircle);
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

export default function ProfileMenu({
  railCollapsed,
  railClassName,
  railOpenClassName,
  railLabelClassName,
  railIconSize = 18,
  railIconClassName,
  inPlace,
}: {
  // The side nav's item styles; without them, the header's button.
  railCollapsed?: boolean;
  railClassName?: string;
  railOpenClassName?: string;
  railLabelClassName?: string;
  railIconSize?: number;
  railIconClassName?: string;
  // In the narrow drawer: its menu drawn in place (AppRail.tsx).
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
  const pendingReviewCount = hasApprovalFlows ? openRevisionCount : 0;

  const canAddOrganization =
    !isCloud() &&
    isMultiOrg() &&
    (showMultiOrgSelfSelector() || allowSelfOrgCreation());
  const currentOrgId = orgId ?? organization.id ?? "";
  const orgName =
    organizations.find((o) => o.id === currentOrgId)?.name ??
    organization.name ??
    "";
  const showOrgPicker = organizations.length > 1;

  const chooseOrg = (id: string) => {
    if (id === currentOrgId || !setOrgId) return;
    setOpen(false);
    // In the drawer, switching closes it, as choosing an item does.
    inPlace?.onDone();
    setOrgId(id);
    try {
      localStorage.setItem("gb-last-picked-org", `"${id}"`);
    } catch (e) {
      console.warn("Unable to save last org in localStorage");
    }
  };

  const go = (href: string) => {
    setOpen(false);
    void router.push(href);
  };
  const themeKey = (preferredTheme ?? "system") as keyof typeof THEME_LABELS;
  const ThemeIcon = THEME_ICONS[themeKey] ?? PiCircleHalf;

  const accountLabel = [
    "Profile",
    name,
    email,
    pendingReviewCount > 0
      ? `${pendingReviewCount} pending review${pendingReviewCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  const item = (
    key: string,
    content: ReactNode,
    onSelect: () => void,
  ): RailMenuEntry => ({ type: "item", key, content, onSelect });
  const themeKeys = Object.keys(THEME_LABELS) as (keyof typeof THEME_LABELS)[];
  const entries: RailMenuEntry[] = [
    {
      type: "item",
      key: "identity",
      className: styles.identity,
      onSelect: () => {
        setOpen(false);
        setEditProfileOpen(true);
      },
      content: (
        <span className={styles.identityContent}>
          <VisuallyHidden>Edit profile: </VisuallyHidden>
          {/* As main's header avatar. */}
          <UserAvatar name={name || ""} email={email || ""} variant="soft" />
          <span className={styles.identityText}>
            {name ? (
              <Text as="div" weight="semibold" truncate>
                {name}
              </Text>
            ) : null}
            <Text as="div" size="sm" color="text-low" truncate>
              {email}
            </Text>
            {/* With several organizations, the picker below shows it. */}
            {orgName && !showOrgPicker ? (
              <span className={styles.orgLine}>
                <PiBuildingBold size={12} aria-hidden="true" />
                <Text size="sm" color="text-low" truncate>
                  {orgName}
                </Text>
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    ...(showOrgPicker
      ? [
          {
            type: "node" as const,
            key: "org-picker",
            node: (
              <div className={styles.orgPicker}>
                <Select
                  size="md"
                  label="Organization"
                  labelSize="sm"
                  value={currentOrgId}
                  setValue={chooseOrg}
                >
                  {organizations.map((o) => (
                    <SelectItem
                      key={o.id}
                      value={o.id}
                      className={styles.orgOption}
                    >
                      {o.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            ),
          },
        ]
      : []),
    ...(canAddOrganization
      ? [
          item(
            "add-org",
            <MenuItemContent Icon={PiPlus} label="Add organization" />,
            () => go("/settings/organizations"),
          ),
        ]
      : []),
    { type: "separator", key: "sep-1" },
    ...(hasApprovalFlows
      ? [
          item(
            "reviews",
            <MenuItemContent
              Icon={PiHourglassHigh}
              label="Pending reviews"
              trailing={
                pendingReviewCount > 0 ? (
                  <Badge
                    label={String(pendingReviewCount)}
                    color="red"
                    variant="solid"
                    radius="full"
                    // At least as wide as it's tall, so one digit is a circle.
                    style={{ minWidth: 20, justifyContent: "center" }}
                  />
                ) : null
              }
            />,
            () => go("/approval-requests"),
          ),
        ]
      : []),
    item(
      "activity",
      <MenuItemContent Icon={ActivityIcon} label="Activity feed" />,
      () => go("/activity"),
    ),
    item(
      "reports",
      <MenuItemContent Icon={PiFileText} label="My reports" />,
      () => go("/reports"),
    ),
    { type: "separator", key: "sep-2" },
    item(
      "tokens",
      <MenuItemContent Icon={TokenIcon} label="Personal access tokens" />,
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
      trigger: (
        <MenuItemContent
          Icon={ThemeIcon}
          label="Theme"
          trailing={
            <Text size="sm" color="text-low">
              {THEME_LABELS[themeKey] ?? "System"}
            </Text>
          }
        />
      ),
      entries: themeKeys.map((key) =>
        item(
          `theme-${key}`,
          <MenuItemContent
            Icon={THEME_ICONS[key]}
            label={key === "system" ? "System default" : THEME_LABELS[key]}
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
      <MenuItemContent Icon={SignOutIcon} label="Sign out" />,
      () => logout(),
    ),
  ];

  const tooltip = useMenuTriggerTooltip({
    label: "Profile",
    enabled: !!railCollapsed && !inPlace,
    menuOpen: open,
  });

  const reviewDot =
    pendingReviewCount > 0 ? (
      <span className={styles.reviewDot} aria-hidden="true" />
    ) : null;

  const trigger = inRail ? (
    <button
      type="button"
      className={clsx(
        railClassName,
        styles.railItem,
        (open || inPlace?.open) && railOpenClassName,
      )}
      aria-label={accountLabel}
      data-rail-menu-trigger="profile"
      {...tooltip.triggerProps}
      {...(inPlace
        ? {
            "aria-expanded": inPlace.open,
            onClick: (e: React.MouseEvent) => inPlace.onOpen(e.detail === 0),
          }
        : {})}
    >
      <span className={styles.avatarWrap}>
        <ProfileIcon
          size={railIconSize}
          className={railIconClassName}
          aria-hidden="true"
        />
        {reviewDot}
      </span>
      {railCollapsed ? null : (
        <span className={railLabelClassName}>{name || email || "Account"}</span>
      )}
      {tooltip.anchor}
    </button>
  ) : (
    // An icon button's size 2 is 24px, as the GrowthBot button's small size.
    <IconButton
      variant="ghost"
      color="gray"
      size="2"
      className={styles.headerButton}
      aria-label={accountLabel}
      data-rail-menu-trigger="profile"
    >
      <ProfileIcon size={16} aria-hidden="true" />
      {reviewDot}
    </IconButton>
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
        {trigger}
        {inPlace.open && inPlace.host
          ? createPortal(
              <InPlaceMenu
                label="Profile"
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
    <>
      {modals}
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        menuPlacement="end"
        menuSide={inRail ? "right" : "bottom"}
        // In the side nav, clear of its edge (the item sits 8px inside it).
        menuSideOffset={inRail ? 16 : undefined}
        // Room for the name, email and organization.
        menuWidth={280}
        variant="soft"
        trigger={trigger}
      >
        <DropdownEntries entries={entries} />
      </DropdownMenu>
    </>
  );
}
