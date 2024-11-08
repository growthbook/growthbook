import clsx from "clsx";
import NextLink from "next/link";
import { LinkProps, Link as RadixLink } from "@radix-ui/themes";
import styles from "./RadixOverrides.module.scss";

type RadixProps = Omit<LinkProps, "color"> & {
  color?: LinkProps["color"] | "dark";
};

type NextProps = React.ComponentProps<typeof NextLink>;

export default function Link({
  children,
  className,
  color,
  ...props
}: RadixProps & NextProps) {
  const isCustomDarkColor = color === "dark";

  return (
    <RadixLink
      className={clsx(styles.link, className, {
        [styles.darkLink]: isCustomDarkColor,
      })}
      color={isCustomDarkColor ? undefined : color}
      {...props}
      asChild
    >
      <NextLink {...props}>{children}</NextLink>
    </RadixLink>
  );
}
