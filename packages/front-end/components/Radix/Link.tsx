import clsx from "clsx";
import NextLink, { LinkProps as NextLinkProps } from "next/link";
import {
  Link as RadixLink,
  LinkProps as RadixLinkProps,
} from "@radix-ui/themes";
import styles from "./RadixOverrides.module.scss";

type RadixProps = Omit<RadixLinkProps, "color" | "href"> & {
  color?: RadixLinkProps["color"] | "dark";
};

type NextProps = Omit<
  NextLinkProps,
  "onClick" | "onMouseEnter" | "onTouchStart" | "href" | "passHref"
>;

// Ensure we always have at least `href` or `onClick`
// Also allows both to be present
type ConditionalProps =
  | ({
      href: NextLinkProps["href"];
    } & NextProps)
  | {
      href?: never;
      onClick: RadixLinkProps["onClick"];
    };

export default function Link({
  children,
  className,
  color,
  href,
  ...props
}: RadixProps & ConditionalProps) {
  const isCustomDarkColor = color === "dark";

  let childrenWrapper: JSX.Element | null = null;
  let radixProps = props;

  if (href === undefined) {
    childrenWrapper = <button type="button">{children}</button>;
  } else {
    const {
      replace,
      as,
      scroll,
      shallow,
      prefetch,
      locale,
      legacyBehavior,
      ...rest
    } = props as NextProps;
    radixProps = rest;

    childrenWrapper = (
      <NextLink
        href={href}
        replace={replace}
        as={as}
        scroll={scroll}
        shallow={shallow}
        prefetch={prefetch}
        locale={locale}
        legacyBehavior={legacyBehavior}
      >
        {children}
      </NextLink>
    );
  }

  return (
    <RadixLink
      className={clsx(styles.link, className, {
        [styles.darkLink]: isCustomDarkColor,
      })}
      color={isCustomDarkColor ? undefined : color}
      {...radixProps}
      asChild
    >
      {childrenWrapper}
    </RadixLink>
  );
}
