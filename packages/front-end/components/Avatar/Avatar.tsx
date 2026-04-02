import { FC } from "react";
import clsx from "clsx";
import { violet } from "@radix-ui/colors";

const Avatar: FC<{
  email: string;
  name: string;
  size?: number;
  className?: string;
  showEmail?: boolean;
}> = ({ email, size = 40, className, name, showEmail = false }) => {
  const firstNameLetter = name?.charAt(0) || email.charAt(0);
  const lastNameLetter = name?.split(" ")[1]?.charAt(0) || "";
  const title = name ? `${name} <${email}>` : email;
  const copy =
    name.toLowerCase() === "api"
      ? name.toUpperCase()
      : `${firstNameLetter.toUpperCase()}${lastNameLetter?.toUpperCase()}`;

  const getFontSize = () => {
    const copyLength = copy.length;
    switch (copyLength) {
      case 1:
        return 0.5 * size;
      case 2:
        return 0.4 * size;
      case 3:
        return 0.4 * size;
      default:
        return 0.7 * size;
    }
  };

  const circle = (
    <div
      className={clsx(
        "align-items-center justify-content-center border rounded-circle d-flex",
        className,
      )}
      title={title}
      style={{
        height: size,
        width: size,
        flexShrink: 0,
        backgroundColor: violet?.violet3,
        color: violet?.violet11,
        fontSize: getFontSize(),
        fontWeight: 600,
      }}
    >
      {copy}
    </div>
  );

  if (!showEmail) return circle;

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.4em" }}
    >
      {circle}
      {name && <span>{name}</span>}
      <span style={{ color: "var(--gray-9)" }}>
        <span style={{ userSelect: "none" }}>&lt;</span>
        {email}
        <span style={{ userSelect: "none" }}>&gt;</span>
      </span>
    </span>
  );
};
export default Avatar;
