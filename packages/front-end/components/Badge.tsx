import React, { CSSProperties } from "react";
import clsx from "clsx";

export default function Badge({
  content,
  className = "badge-primary",
  style,
  title,
}: {
  content: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <span className={clsx("badge mr-2", className)} style={style} title={title}>
      {content}
    </span>
  );
}
