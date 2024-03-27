import React, { CSSProperties, ReactElement } from "react";
import clsx from "clsx";

export default function Badge({
  content,
  className = "badge-primary",
  style,
  title,
  skipMargin,
}: {
  content: string | ReactElement;
  className?: string;
  style?: CSSProperties;
  title?: string;
  skipMargin?: boolean;
}) {
  return (
    <span
      className={clsx("badge", className, { "ml-2": !skipMargin })}
      style={style}
      title={title}
    >
      {content}
    </span>
  );
}
