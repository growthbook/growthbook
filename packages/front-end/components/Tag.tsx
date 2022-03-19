import React, { FC, DetailedHTMLProps, HTMLAttributes } from "react";
import clsx from "clsx";
import { useDefinitions } from "../services/DefinitionsContext";

interface Props
  extends DetailedHTMLProps<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> {
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
  const { tags } = useDefinitions();
  const fullTag = { name: tag, color: "#029dd1", description: "" };
  tags?.forEach((t) => {
    if (t.name === tag) {
      fullTag.name = tag;
      fullTag.color = t?.color ?? "#029dd1";
      fullTag.description = t?.description ?? "";
    }
  });

  const displayTitle = description ?? fullTag.description;
  const displayColor = color ?? fullTag.color;

  return (
    <>
      <span
        {...otherProps}
        className={clsx("tag", "mr-2", "badge", "badge-primary", className)}
        title={displayTitle}
        style={{ backgroundColor: displayColor }}
        onClick={async (e) => {
          e.preventDefault();
          try {
            await onClick();
          } catch (e) {
            console.error(e);
          }
        }}
      >
        {tag}
        {children}
      </span>
    </>
  );
};

export default Tag;
