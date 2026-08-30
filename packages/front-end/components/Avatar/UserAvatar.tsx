import { ReactElement } from "react";
import { FaRobot } from "react-icons/fa";
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
): string | ReactElement => {
  // Special display for API and System users when we don't have a real name or email
  if (name?.toLowerCase() === "api") return <FaRobot />;
  if (name?.toLowerCase() === "system") return <FaRobot />;
  if (!name && !email) return isApi ? <FaRobot /> : "?";

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
  if (icon) {
    return <Avatar {...otherProps}>{icon}</Avatar>;
  }

  return <Avatar {...otherProps}>{getUserAvatar(name, email, isApi)}</Avatar>;
}
