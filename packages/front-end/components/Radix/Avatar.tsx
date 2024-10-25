import { Avatar as RadixAvatar, AvatarProps } from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import styles from "./RadixOverrides.module.scss";

export type Size = "sm" | "md" | "lg";

export function getRadixSize(size: Size): Responsive<"1" | "2" | "3"> {
  switch (size) {
    case "sm":
      return "1";
    case "md":
      return "2";
    case "lg":
      return "3";
  }
}

type Props = {
  size?: Size;
  color?: AvatarProps["color"];
  variant?: "solid" | "soft";
  radius?: "full" | "small";
  name: string;
  email?: string;
} & MarginProps;

export default function Avatar({
  size = "md",
  color = "violet",
  variant = "solid",
  radius = "full",
  name,
  email,
  ...otherProps
}: Props) {
  const firstNameLetter = name?.charAt(0);
  const lastNameLetter = name?.split(" ")[1]?.charAt(0) || "";
  const title = name ? `${name} <${email}>` : email;
  const userInitials =
    name.toLowerCase() === "api"
      ? name.toUpperCase()
      : `${firstNameLetter.toUpperCase()}${lastNameLetter?.toUpperCase()}`;

  return (
    <RadixAvatar
      {...otherProps}
      title={title}
      className={styles.avatar}
      size={getRadixSize(size)}
      color={color}
      variant={variant}
      radius={radius}
      fallback={userInitials}
    />
  );
}
