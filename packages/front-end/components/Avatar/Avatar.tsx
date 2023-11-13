import { FC } from "react";
import md5 from "md5";
import clsx from "clsx";

const Avatar: FC<{
  email: string;
  size?: number;
  className?: string;
  name?: string;
}> = ({ email, size = 40, className, name }) => {
  const hash = md5(email?.trim()?.toLowerCase() || "");
  const url = `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${size}`;

  const title = name ? `${name} <${email}>` : email;

  return (
    <img
      className={clsx("border rounded-circle", className)}
      src={url}
      title={title}
      style={{
        width: size + 2,
        height: size + 2,
      }}
    />
  );
};
export default Avatar;
