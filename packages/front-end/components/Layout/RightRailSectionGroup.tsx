import { Children, FC } from "react";

const RightRailSectionGroup: FC<{
  title?: string;
  type?: "badge" | "code" | "list" | "pre" | "onoff" | "custom";
  empty?: string;
  badgeStyle?: string;
  className?: string;
}> = ({
  children,
  title = "",
  type = "custom",
  empty = "None",
  badgeStyle = "",
  className = "",
}) => {
  let hasChildren = type === "onoff" || !!children;
  if (Array.isArray(children)) {
    hasChildren =
      children.filter((v) => v !== null && v !== undefined).length > 0;
  }

  return (
    <div className={`mb-2 ${className}`}>
      {title && (
        <small className="mr-2">
          <em>{title}:</em>
        </small>
      )}
      {hasChildren ? (
        <>
          {type === "badge" &&
            Children.map(children, (child, i) => {
              if (child === null || child === undefined) return "";
              return (
                <span
                  className={`badge ${
                    badgeStyle === "" ? "badge-primary" : badgeStyle
                  } mr-2`}
                  key={i}
                >
                  {child}
                </span>
              );
            })}
          {type === "pre" && (
            <pre className="m-0 bg-light border p-1">{children}</pre>
          )}
          {type === "list" && (
            <ul>
              {Children.map(children, (child, i) => {
                return <li key={i}>{child}</li>;
              })}
            </ul>
          )}
          {type === "onoff" && (
            <span
              className={`badge mr-2 ${
                children ? "badge-primary" : "badge-secondary"
              }`}
            >
              {children ? "ON" : "OFF"}
            </span>
          )}
          {type === "code" && <code className="border p-1">{children}</code>}
          {type === "custom" && children}
        </>
      ) : (
        <em>{empty}</em>
      )}
    </div>
  );
};

export default RightRailSectionGroup;
