import React from "react";
// eslint-disable-next-line import/no-unresolved
import Link from "@docusaurus/Link";

export default function ButtonCard({
  className,
  children,
  icon,
  title,
  description,
  to,
  aLink = false,
  layout = "vertical",
  align = "left",
  color = "default",
}) {
  if (aLink) {
    return (
      <a
        href={to}
        className={[
          "button-card",
          `button-card--${layout}`,
          `button-card--${align}`,
          `button-card--${color}`,
          className,
        ].join(" ")}
      >
        {children ? (
          <div className="button-card__inner">{children}</div>
        ) : (
          <div className="button-card__inner">
            {icon && typeof icon == "string" ? (
              <img alt="icon" src={icon} width={24} />
            ) : (
              icon
            )}
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        )}
      </a>
    );
  }
  return (
    <Link
      to={to}
      className={[
        "button-card",
        `button-card--${layout}`,
        `button-card--${align}`,
        `button-card--${color}`,
        className,
      ].join(" ")}
    >
      {children ? (
        <div className="button-card__inner">{children}</div>
      ) : (
        <div className="button-card__inner">
          {icon && typeof icon == "string" ? (
            <img alt="icon" src={icon} width={24} />
          ) : (
            icon
          )}
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      )}
    </Link>
  );
}
