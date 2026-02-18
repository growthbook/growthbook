import clsx from "clsx";
import { ForwardedRef, forwardRef } from "react";
import NextLink, { LinkProps as NextLinkProps } from "next/link";
import {
  Link as RadixLink,
  LinkProps as RadixLinkProps,
} from "@radix-ui/themes";
import styles from "./Link.module.scss";

type RadixProps = Omit<RadixLinkProps, "color" | "href"> & {
  type?: "submit" | "reset" | "button";
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
      type?: "submit" | "reset" | "button";
      onClick?: RadixLinkProps["onClick"];
    };

type Props = RadixProps & ConditionalProps;

const Link = forwardRef<HTMLAnchorElement, Props>(
  (
    { children, className, color, href, type = "button", ...props },
    ref: ForwardedRef<HTMLAnchorElement>,
  ) => {
    const isCustomDarkColor = color === "dark";

    let childrenWrapper: React.ReactNode | null;
    let radixProps = props;

    if (href === undefined) {
      childrenWrapper = <button type={type}>{children}</button>;
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
        ref={ref}
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
  },
);

Link.displayName = "Link";
export default Link;
