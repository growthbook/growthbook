import React, { CSSProperties, ReactElement } from "react";
import clsx from "clsx";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./EntityBadge.module.scss";

const ENTITY_BADGE_MAX_WIDTH = 400;

// The gray chip every entity and value in a rule or condition summary shares.
export function EntityBadge({
  label,
  title,
  className,
  style,
}: {
  label: string | ReactElement;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Badge
      color="gray"
      className={clsx(styles.badge, className)}
      title={title}
      style={style}
      label={label}
    />
  );
}

export function LinkedEntityBadge({
  href,
  title,
  label,
}: {
  href: string;
  title: string;
  label: string;
}) {
  return (
    <EntityBadge
      label={
        <Link
          href={href}
          target="_blank"
          title={title}
          className="hover-underline"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            overflow: "hidden",
            color: "var(--accent-11)",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: ENTITY_BADGE_MAX_WIDTH,
            }}
          >
            {label}
          </span>
        </Link>
      }
    />
  );
}

export function PlainEntityBadge({
  label,
  maxWidth = ENTITY_BADGE_MAX_WIDTH,
}: {
  label: string;
  maxWidth?: number;
}) {
  return (
    <EntityBadge
      className="text-ellipsis d-inline-block"
      style={{ maxWidth }}
      title={label}
      label={
        <Text size="inherit" whiteSpace="pre" color="text-high">
          {label}
        </Text>
      }
    />
  );
}
