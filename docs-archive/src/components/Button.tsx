import React from "react";

type ButtonOrLinkProps<T extends React.ElementType> = {
  as?: T;
} & React.ComponentPropsWithoutRef<T>;

export default function Button<T extends React.ElementType = "button">({
  as,
  children,
  ...props
}: ButtonOrLinkProps<T>) {
  const Component = as || "button";
  return (
    <Component {...props} className="button">
      {children}
    </Component>
  );
}
