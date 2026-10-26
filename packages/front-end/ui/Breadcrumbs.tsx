import React from "react";
import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import { PiCaretRight } from "react-icons/pi";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./Breadcrumbs.module.scss";

export interface BreadcrumbItem {
  display: string;
  href?: string;
}

// Gray ancestors with "/" separators; only the current crumb is bold.
export default function Breadcrumbs({
  items,
  muted = false,
}: {
  items: BreadcrumbItem[];
  muted?: boolean;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <Flex align="center" gap={muted ? "2" : "1"}>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;

          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className={styles.separator} aria-hidden="true">
                  {muted ? (
                    <Text size="md" color="text-low">
                      /
                    </Text>
                  ) : (
                    <PiCaretRight
                      size={15}
                      style={{ color: "var(--color-text-high)" }}
                    />
                  )}
                </span>
              )}
              <span
                title={item.display}
                className={isLast ? styles.current : styles.ancestor}
              >
                {item.href ? (
                  <Link
                    className={!isLast ? styles.crumbLink : undefined}
                    truncate
                    href={item.href}
                    size="md"
                    weight={muted && !isLast ? "regular" : "bold"}
                    color={muted && !isLast ? "gray" : undefined}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {item.display}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={clsx(!isLast && styles.crumbLink, {
                      [styles.mutedCrumb]: muted && !isLast,
                    })}
                  >
                    <Text
                      size="md"
                      weight={muted && !isLast ? "regular" : "semibold"}
                      color={muted && !isLast ? undefined : "text-high"}
                      truncate
                    >
                      {item.display}
                    </Text>
                  </span>
                )}
              </span>
            </React.Fragment>
          );
        })}
      </Flex>
    </nav>
  );
}
