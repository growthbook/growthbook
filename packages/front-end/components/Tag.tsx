import React, { FC, DetailedHTMLProps, HTMLAttributes } from "react";
import clsx from "clsx";
import { useDefinitions } from "../services/DefinitionsContext";

interface Props
  extends DetailedHTMLProps<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> {
  tag: string;
  onClick?: () => Promise<void>;
}

const Tag: FC<Props> = ({
  tag,
  onClick,
  children,
  className,
  ...otherProps
}) => {
  const { tags } = useDefinitions();
  const fullTag = { name: tag, color: "#029dd1", description: "" };
  tags.tags.forEach((t) => {
    if (t === tag) {
      fullTag.name = tag;
      fullTag.color = tags?.settings?.[tag].color ?? "#029dd1";
      fullTag.description = tags?.settings?.[tag]?.description ?? "";
    }
  });

  return (
    <>
      <span
        {...otherProps}
        className={clsx("badge", "badge-primary", className)}
        title={fullTag.description}
        style={{ backgroundColor: fullTag.color }}
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
