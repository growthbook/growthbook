import { FC } from "react";
import md5 from "md5";
import clsx from "clsx";

const Avatar: FC<{ email: string; size?: number; className?: string }> = ({
  email,
  size = 40,
  className,
}) => {
  const hash = md5(email?.trim()?.toLowerCase() || "");
  const url = `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${size}`;

  return <img className={clsx("border rounded-circle", className)} src={url} />;
};
export default Avatar;
