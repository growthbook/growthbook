import React, { Children, FC } from "react";
import styles from "./RightRailSectionGroup.module.scss";
import SortedTags from "../Tags/SortedTags";
import { ReactNode } from "react";

const RightRailSectionGroup: FC<{
  title?: string;
  type?:
    | "badge"
    | "code"
    | "list"
    | "pre"
    | "onoff"
    | "custom"
    | "commaList"
    | "tags";
  empty?: string;
  badgeStyle?: string;
  className?: string;
  children?: ReactNode;
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
      {title && <span className={`mr-2 ${styles.title}`}>{title}:</span>}
      {hasChildren ? (
        <>
          {type === "tags" && (
            <SortedTags
              tags={Children.map(children, (child) => child + "").filter(
                Boolean
              )}
            />
          )}
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
          {type === "commaList" && (
            <span className="commalist">
              {Children.map(children, (child, i) => {
                if (!child) return null;

                return (
                  <span className="font-weight-bold" key={i}>
                    {child}
                  </span>
                );
              })}
            </span>
          )}
        </>
      ) : (
        <em>{empty}</em>
      )}
    </div>
  );
};

export default RightRailSectionGroup;
