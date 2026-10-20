import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiXBold } from "react-icons/pi";
import clsx from "clsx";
import styles from "./PopoverNotice.module.scss";

// PROTOTYPE (set in review): a popover's notice layout, for @/ui/Popover's
// content: an optional icon, a header, a description and a footer with its
// button(s), all left-aligned, the description and footer under the
// header's text rather than the icon. In the redesign's type: the header at
// 16px, 600 (as Modal's titles), and the description at 13px, both in
// --gray-12. It brings no padding or width of its own, so the popover (or
// a list of these) sets those. First used by the header's notices list
// (NoticeIndicator.tsx); GrowthBot's notice (GrowthBotStateNotice.tsx) has
// the same shape and could move onto it.
// Opt-in (set in review): a band behind the icon and header, in its
// status's colour (error red, warning amber, info light grey), the
// description and footer below it on the popover's white; and a close
// button in the band's top right. Banded, it brings its own padding (16px
// in), so the band reaches the popover's edges.
export type PopoverNoticeStatus = "error" | "warning" | "info";

export default function PopoverNotice({
  icon,
  title,
  description,
  footer,
  status,
  onClose,
  closeLabel = "Close",
  titleText,
}: {
  // Sized by the caller (18px suits the header's line), and coloured by it
  // too; --slate-11 when not.
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  // The button(s), 12px apart.
  footer?: ReactNode;
  // The band's colour; no band without it.
  status?: PopoverNoticeStatus;
  // A close button, top right, when given.
  onClose?: () => void;
  closeLabel?: string;
  // The header as plain text, for the browser tooltip a banded header shows
  // when it's cut short; its text content otherwise.
  titleText?: string;
}) {
  const close = onClose ? (
    <CloseButton onClose={onClose} label={closeLabel} />
  ) : null;

  if (status) {
    return (
      <div>
        <Flex
          gap="2"
          align="start"
          className={clsx(
            styles.band,
            styles[status],
            onClose && styles.withClose,
          )}
        >
          {icon ? (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <BandTitle titleText={titleText}>{title}</BandTitle>
          {close ? <span className={styles.corner}>{close}</span> : null}
        </Flex>
        {description ? (
          <div className={clsx(styles.description, styles.bandBody)}>
            {description}
          </div>
        ) : null}
        {/* The footer its own section. TRYING (set in review): no line
          above it; it had Radix's Separator at full width, in --slate-a6
          (<Separator size="4" style={{ backgroundColor:
          "var(--slate-a6)" }} />). */}
        {footer ? (
          <>
            {/* Left-aligned, 12px apart (set in review; tried right-aligned,
              as a modal's footer). */}
            <Flex
              gap="3"
              align="center"
              wrap="wrap"
              className={styles.bandFooter}
            >
              {footer}
            </Flex>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <Flex gap="2" align="start">
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Flex direction="column" minWidth="0" flexGrow="1">
        <div className={styles.title}>{title}</div>
        {description ? (
          <div className={styles.description}>{description}</div>
        ) : null}
        {footer ? (
          <Flex gap="3" align="center" wrap="wrap" className={styles.footer}>
            {footer}
          </Flex>
        ) : null}
      </Flex>
      {close}
    </Flex>
  );
}

// The banded header, on one line: when it's cut short with an ellipsis,
// the browser's own tooltip shows it in full on hover (set in review).
function BandTitle({
  children,
  titleText,
  className,
}: {
  children: ReactNode;
  titleText?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);
  return (
    <div
      ref={ref}
      className={clsx(styles.title, styles.bandTitle, className)}
      title={
        truncated ? (titleText ?? ref.current?.textContent ?? "") : undefined
      }
    >
      {children}
    </div>
  );
}

// The list variant (set in review): notices grouped under full-width
// bands that say how urgent they are (e.g. "Needs attention", "Warnings"),
// in the band's colours and type, each notice below it as an unbanded
// PopoverNotice, 16px in, a line between them. No count.
export function PopoverNoticeGroup({
  status,
  icon,
  label,
  count,
  children,
  onClose,
  closeLabel = "Close",
}: {
  status: PopoverNoticeStatus;
  icon?: ReactNode;
  label: string;
  // How many, as a number after the label, as the experiments list's tabs
  // (set in review).
  count?: number;
  // The group's notices, each a PopoverNotice.
  children: ReactNode;
  // A close button in the band's top right, as the single notice's (set in
  // review): give it to the first group, at the popover's top.
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <section aria-label={label}>
      <Flex
        gap="2"
        align="start"
        className={clsx(
          styles.band,
          styles.groupBand,
          styles[status],
          onClose && styles.withClose,
        )}
      >
        {icon ? (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <BandTitle titleText={label} className={styles.groupLabel}>
          {label}
          {count !== undefined ? (
            <span className={styles.groupCount}>{count}</span>
          ) : null}
        </BandTitle>
        {onClose ? (
          <span className={styles.corner}>
            <CloseButton onClose={onClose} label={closeLabel} />
          </span>
        ) : null}
      </Flex>
      <div className={styles.groupItems}>{children}</div>
    </section>
  );
}

function CloseButton({
  onClose,
  label,
}: {
  onClose: () => void;
  label: string;
}) {
  return (
    <IconButton
      variant="ghost"
      color="gray"
      size="1"
      className={styles.close}
      onClick={onClose}
      aria-label={label}
    >
      <PiXBold size={14} />
    </IconButton>
  );
}
