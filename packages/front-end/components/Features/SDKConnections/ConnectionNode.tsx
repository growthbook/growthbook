import { ReactElement, ReactNode } from "react";

export default function ConnectionNode({
  children,
  title,
  first,
  last,
}: {
  children: ReactElement;
  title: ReactNode;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`appbox p-3 ${
        first ? "mr" : last ? "ml" : "mx"
      }-3 text-center position-relative`}
      style={{
        zIndex: 10,
        overflow: "visible",
      }}
    >
      <h3>{title}</h3>
      {children}
    </div>
  );
}
