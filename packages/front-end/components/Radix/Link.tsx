import clsx from "clsx";
import { ForwardedRef, forwardRef, ReactNode } from "react";
import NextLink, { LinkProps as NextLinkProps } from "next/link";
import {
  Text,
  Link as RadixLink,
  LinkProps as RadixLinkProps,
} from "@radix-ui/themes";
import { PiArrowSquareOut, PiPlusCircleFill } from "react-icons/pi";
import styles from "./RadixOverrides.module.scss";

type RadixProps = Omit<RadixLinkProps, "color" | "href"> & {
  type?: "submit" | "reset" | "button";
  color?: RadixLinkProps["color"] | "dark";
  iconVariant?: "externalLink" | "plusButton";
  icon?: ReactNode;
  iconPosition?: "left" | "right";
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
    {
      children,
      className,
      color,
      href,
      type,
      iconVariant,
      icon,
      iconPosition = "right",
      ...props
    },
    ref: ForwardedRef<HTMLAnchorElement>
  ) => {
    const isCustomDarkColor = color === "dark";

    if (iconVariant === "externalLink") {
      icon = <PiArrowSquareOut style={{ verticalAlign: -2 }} />;
      iconPosition = "right";
    } else if (iconVariant === "plusButton") {
      icon = <PiPlusCircleFill style={{ verticalAlign: -2 }} />;
      iconPosition = "left";
    }

    let childrenWrapper: JSX.Element | null;
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
          {icon && iconPosition === "left" ? (
            <Text style={{ marginRight: 2 }}>{icon}</Text>
          ) : null}
          {children}
          {icon && iconPosition === "right" ? (
            <Text style={{ marginLeft: 2 }}>{icon}</Text>
          ) : null}
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
  }
);

Link.displayName = "Link";
export default Link;
