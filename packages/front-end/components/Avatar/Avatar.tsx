import { FC } from "react";
import clsx from "clsx";
import { gravatarForEmail } from "@/components/Avatar/Avatar.utils";

const Avatar: FC<{ email: string; size?: number; className?: string }> = ({
  email,
  size = 40,
  className,
}) => {
  const url = gravatarForEmail(email, size);

  return <img className={clsx("border rounded-circle", className)} src={url} />;
};
export default Avatar;
