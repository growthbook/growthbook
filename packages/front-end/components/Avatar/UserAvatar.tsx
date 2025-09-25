import { ReactElement } from "react";
import Avatar, { Props as AvatarProps } from "@/ui/Avatar";

type Props = {
  name: string;
  icon?: ReactElement;
} & Omit<AvatarProps, "children">;

const getUserAvatar = (
  name: string,
  icon?: ReactElement,
): string | ReactElement => {
  if (icon) return icon;

  const firstNameLetter = name?.charAt(0);
  const lastNameLetter = name?.split(" ")[1]?.charAt(0) || "";
  const userInitials =
    name.toLowerCase() === "api"
      ? name.toUpperCase()
      : `${firstNameLetter.toUpperCase()}${lastNameLetter?.toUpperCase()}`;

  return userInitials;
};

export default function UserAvatar({ name, icon, ...otherProps }: Props) {
  return <Avatar {...otherProps}>{getUserAvatar(name, icon)}</Avatar>;
}
