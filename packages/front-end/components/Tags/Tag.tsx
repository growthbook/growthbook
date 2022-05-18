import React, { FC, DetailedHTMLProps, HTMLAttributes } from "react";
import clsx from "clsx";
import { useDefinitions } from "../../services/DefinitionsContext";

interface Props
  extends DetailedHTMLProps<
    HTMLAttributes<HTMLAnchorElement>,
    HTMLAnchorElement
  > {
  tag: string;
  color?: string;
  description?: string;
  onClick?: () => Promise<void>;
}

const Tag: FC<Props> = ({
  tag,
  color,
  description,
  onClick,
  children,
  className,
  ...otherProps
}) => {
  const { getTagById } = useDefinitions();
  const fullTag = getTagById(tag);

  const displayTitle = description ?? fullTag?.description ?? "";
  const displayColor = color ?? fullTag?.color ?? "#029dd1";

  return (
    <a
      {...otherProps}
      className={clsx("tag", "mr-2", "badge", "badge-primary", className)}
      title={displayTitle}
      style={{
        backgroundColor: displayColor,
        color: useDarkText(displayColor) ? "#000000" : "#ffffff",
        ...otherProps.style,
      }}
      href={onClick ? "#" : undefined}
      onClick={async (e) => {
        e.preventDefault();
        if (!onClick) return;
        try {
          await onClick();
        } catch (e) {
          console.error(e);
        }
      }}
    >
      {tag}
      {children && <> {children}</>}
    </a>
  );
};

export default Tag;

export function useDarkText(bgColor: string): boolean {
  if (!bgColor || bgColor === "") return true;
  const color = bgColor.charAt(0) === "#" ? bgColor.substring(1, 7) : bgColor;
  const r = parseInt(color.substring(0, 2), 16); // hexToR
  const g = parseInt(color.substring(2, 4), 16); // hexToG
  const b = parseInt(color.substring(4, 6), 16); // hexToB
  return r * 0.299 + g * 0.587 + b * 0.114 > 186;
}
