import React from "react";
import clsx from "clsx";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./EntityBadge.module.scss";

const ENTITY_BADGE_MAX_WIDTH = 400;

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
    <Badge
      color="gray"
      className={styles.badge}
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
    <Badge
      color="gray"
      className={clsx(styles.badge, "text-ellipsis d-inline-block")}
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
