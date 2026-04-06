import { ReactElement } from "react";
import Avatar, { Props as AvatarProps } from "@/ui/Avatar";

type Props = {
  name?: string;
  email?: string;
  isApi?: boolean;
  icon?: ReactElement;
} & Omit<AvatarProps, "children">;

const getUserAvatar = (
  name?: string,
  email?: string,
  isApi?: boolean,
  icon?: ReactElement,
): string | ReactElement => {
  if (icon) return icon;
  if (name?.toLowerCase() === "api") return "API";
  if (!name && !email) return isApi ? "API" : "?";

  if (name) {
    const firstNameLetter = name.charAt(0);
    const lastNameLetter = name.split(" ")[1]?.charAt(0) || "";

    return `${firstNameLetter.toUpperCase()}${lastNameLetter?.toUpperCase()}`;
  }

  const firstEmailLetter = email?.charAt(0) || "";
  return firstEmailLetter.toUpperCase() || "?";
};

export default function UserAvatar({
  name,
  email,
  isApi,
  icon,
  ...otherProps
}: Props) {
  return (
    <Avatar {...otherProps}>{getUserAvatar(name, email, isApi, icon)}</Avatar>
  );
}
