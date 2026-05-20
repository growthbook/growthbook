import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretRight } from "react-icons/pi";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./Breadcrumbs.module.scss";

export interface BreadcrumbItem {
  display: string;
  href?: string;
}

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <Flex align="center" gap="1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;

          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className={styles.separator} aria-hidden="true">
                  <PiCaretRight
                    size={15}
                    style={{ color: "var(--color-text-high)" }}
                  />
                </span>
              )}
              <span
                title={item.display}
                className={!isLast ? styles.ancestor : undefined}
              >
                {item.href ? (
                  <Link
                    href={item.href}
                    size="2"
                    weight="bold"
                    aria-current={isLast ? "page" : undefined}
                  >
                    {item.display}
                  </Link>
                ) : (
                  <span aria-current={isLast ? "page" : undefined}>
                    <Text size="medium" weight="semibold" color="text-high">
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
