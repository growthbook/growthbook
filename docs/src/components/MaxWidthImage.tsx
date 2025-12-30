import React from "react";

export default function MaxWidthImage({
  maxWidth = 800,
  border = false,
  caption,
  children,
}: {
  maxWidth?: number;
  border?: boolean;
  caption?: string;
  children: React.ReactNode;
}) {
  const content =
    React.isValidElement(children) && children.type === "p"
      ? (children as React.ReactElement<{ children: React.ReactNode }>).props
          .children
      : children;

  return (
    <figure
      style={{
        maxWidth: `${maxWidth}px`,
      }}
      className={`${border ? "has-border" : ""} max-width-image`}
    >
      {content}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
