import React from "react";

export default function Pill({
  className,
  children,
  title,
  pillType = "default",
}) {
  return (
    <div className={["pill", `pill-type--${pillType}`, className].join(" ")}>
      {children ? children : <>{title}</>}
    </div>
  );
}
