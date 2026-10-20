import React from "react";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

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

export function PlainEntityBadge({ label }: { label: string }) {
  return (
    <Badge
      color="gray"
      className="text-ellipsis d-inline-block"
      style={{ maxWidth: ENTITY_BADGE_MAX_WIDTH }}
      title={label}
      label={
        <Text size="inherit" whiteSpace="pre" color="text-high">
          {label}
        </Text>
      }
    />
  );
}
