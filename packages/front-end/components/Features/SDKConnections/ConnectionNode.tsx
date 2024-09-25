import { ReactElement, ReactNode } from "react";

function ConnectionDot({ left }: { left: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        [left ? "right" : "left"]: "100%",
        top: "50%",
        marginTop: -7,
        [left ? "marginRight" : "marginLeft"]: -8,
        width: 16,
        height: 16,
        borderRadius: 20,
        border: "3px solid var(--text-color-primary)",
        background: "#fff",
        zIndex: 1,
      }}
    />
  );
}

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
      {!first && <ConnectionDot left={true} />}
      {!last && <ConnectionDot left={false} />}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
