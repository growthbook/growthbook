import { useRouter } from "next/router";
import clsx from "clsx";
import { PiWarningFill } from "react-icons/pi";
import Button from "@/ui/Button";
import PopoverNotice from "@/ui/PopoverNotice";
import buttonStyles from "@/ui/Button.module.scss";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { AppNotice } from "./notices";
import {
  asHeading,
  asSentence,
  dismissNotice,
  isDismissible,
} from "./headerNotices";
import styles from "./HeaderNotices.module.scss";

// PROTOTYPE (set in review): one notice in the header's lists (the
// warnings list, NoticeIndicator.tsx, and the banner's other errors,
// NoticeBanner.tsx): its title, details, action and, for warnings, Dismiss.

export type Upgrade = NonNullable<AppNotice["upgrade"]>;

// What a notice's link says, by notice (they had none; the pill itself was
// the link).
// Title case, every word capitalized (set in review).
const LINK_LABELS: Record<string, string> = {
  "sdk-payload-size": "View SDK Connections",
  "personal-access-token-expiry": "View Tokens",
  "api-key-expiry": "View API Keys",
};

export type NoticeAction =
  | { kind: "upgrade"; label: string; upgrade: Upgrade }
  | { kind: "link"; label: string; href: string };

// A notice's action, for people who can take it: Upgrade Plan for those
// who manage billing, and links for everyone (the page they open checks
// its own permissions).
export function useNoticeAction() {
  const canManageBilling = usePermissionsUtil().canManageBilling();
  return (notice: AppNotice): NoticeAction | null => {
    if (notice.href) {
      return {
        kind: "link",
        label: LINK_LABELS[notice.id] ?? "View Details",
        href: notice.href,
      };
    }
    if (notice.upgrade && canManageBilling) {
      return {
        kind: "upgrade",
        label: "Upgrade Plan", // title case (set in review)
        upgrade: notice.upgrade,
      };
    }
    return null;
  };
}

export function NoticeActionButton({
  action,
  onUpgrade,
  color,
  variant = "soft",
}: {
  action: NoticeAction;
  onUpgrade: (upgrade: Upgrade) => void;
  color: "red" | "gray" | "violet" | "amber";
  variant?: "solid" | "soft" | "outline";
}) {
  const router = useRouter();
  const button = (
    <Button
      size="sm"
      variant={variant}
      // @/ui/Button has no amber, so amber is "inherit" in an amber accent
      // (below): Radix's own amber. Solid, it's --amber-11 with a white
      // label (set in review; tried --amber-9, and --amber-contrast, the
      // near black).
      color={color === "amber" ? "inherit" : color}
      // Solid amber and red get fills dark enough for their white label
      // (set in review): the solid red's own --red-9 is 3.9:1, under the
      // 4.5:1 its 12px label needs.
      // With the primary buttons' 6px corners and press (settling to 98%;
      // set in review), which @/ui/Button gives only violet solid ones.
      className={
        variant === "solid" && color === "amber"
          ? clsx(styles.amberSolid, buttonStyles.pressable)
          : variant === "solid" && color === "red"
            ? clsx(styles.redSolid, buttonStyles.pressable)
            : undefined
      }
      onClick={() =>
        action.kind === "upgrade"
          ? onUpgrade(action.upgrade)
          : router.push(action.href)
      }
    >
      {action.label}
    </Button>
  );
  return color === "amber" ? (
    <span data-accent-color="amber" style={{ display: "contents" }}>
      {button}
    </span>
  ) : (
    button
  );
}

export default function NoticeListItem({
  notice,
  action,
  onUpgrade,
  canDismiss = true,
  onDismiss,
  onClose,
}: {
  notice: AppNotice;
  action: NoticeAction | null;
  onUpgrade: (upgrade: Upgrade) => void;
  canDismiss?: boolean;
  onDismiss?: () => void;
  // Alone in its popover (set in review): its header in a band of its
  // colour, with a close button that closes the popover. Without it, a
  // notice in a group's list.
  onClose?: () => void;
}) {
  const red = notice.severity === "error";
  const dismissible = canDismiss && isDismissible(notice);
  const dismissButton = () =>
    dismissible ? (
      <Button
        size="sm"
        variant="ghost"
        color="gray"
        className={modalStandardStyles.ghostButton}
        style={{ borderRadius: "var(--radius-3)", color: "var(--slate-12)" }}
        onClick={() => {
          dismissNotice(notice);
          onDismiss?.();
        }}
        aria-label={`Dismiss: ${notice.title}`}
      >
        Dismiss
      </Button>
    ) : null;
  // @/ui/PopoverNotice (set in review): alone in its popover, its header
  // in a band of its colour with a close button; in a group's list
  // (NoticeIndicator.tsx), just its title, details and footer, the group's
  // band saying how urgent it is.
  return (
    <PopoverNotice
      status={onClose ? (red ? "error" : "warning") : undefined}
      onClose={onClose}
      closeLabel="Close notices"
      titleText={asHeading(notice.title)}
      icon={
        onClose ? (
          <PiWarningFill
            size={18}
            className={red ? styles.iconRed : styles.iconAmber}
          />
        ) : undefined
      }
      title={
        <>
          {red ? <span className="sr-only">Needs attention: </span> : null}
          {/* Capitalized, as a heading; the description as sentences (set
            in review; headerNotices.ts). */}
          {asHeading(notice.title)}
        </>
      }
      description={
        typeof notice.details === "string"
          ? asSentence(notice.details)
          : notice.details
      }
      // The main action first, solid, in the notice's colour (amber for
      // warnings, red for red ones), then the secondary, Dismiss, as a
      // modal's grey ghost Cancel (set in review; tried right-aligned, the
      // main action last, as a modal's footer).
      footer={
        action || dismissible ? (
          <>
            {action ? (
              <NoticeActionButton
                action={action}
                onUpgrade={onUpgrade}
                color={red ? "red" : "amber"}
                variant="solid"
              />
            ) : null}
            {dismissButton()}
          </>
        ) : undefined
      }
    />
  );
}
