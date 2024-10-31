import Avatar, { Props as AvatarProps } from "@/components/Radix/Avatar";

type Props = {
  name: string;
} & Omit<AvatarProps, "children">;

export default function InitialAvatar({ name, ...otherProps }: Props) {
  const firstNameLetter = name?.charAt(0);
  const lastNameLetter = name?.split(" ")[1]?.charAt(0) || "";
  const userInitials =
    name.toLowerCase() === "api"
      ? name.toUpperCase()
      : `${firstNameLetter.toUpperCase()}${lastNameLetter?.toUpperCase()}`;

  return <Avatar {...otherProps}>{userInitials}</Avatar>;
}
