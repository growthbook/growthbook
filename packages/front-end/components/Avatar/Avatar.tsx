import { FC } from "react";
import clsx from "clsx";
import { violet } from "@radix-ui/colors";

const Avatar: FC<{
  email: string;
  size?: number;
  className?: string;
  name?: string;
}> = ({ email, size = 40, className, name }) => {
  const firstNameLetter = name?.charAt(0) || email.charAt(0);
  const lastNameLetter = name?.split(" ")[1]?.charAt(0);
  return (
    //round avatar with initals in the middle
    <div
      className={clsx(
        "align-items-center justify-content-center border rounded-circle d-flex",
        className
      )}
      style={{
        height: size,
        width: size,
        backgroundColor: violet?.violet3,
        color: violet?.violet11,
        fontSize: size / 2,
        fontWeight: 600,
      }}
    >
      {firstNameLetter.toUpperCase()}
      {lastNameLetter?.toLocaleUpperCase()}
    </div>
  );
};
export default Avatar;
