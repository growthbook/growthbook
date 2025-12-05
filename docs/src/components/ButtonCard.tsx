import React from "react";
// eslint-disable-next-line import/no-unresolved
import Link from "@docusaurus/Link";

type Props = {
  className?: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
  description: string;
  to: string;
  aLink?: boolean;
  layout?: "vertical" | "horizontal";
  align?: "left" | "center" | "right";
  color?: "default" | "primary" | "secondary" | "tertiary";
};

export default function ButtonCard({
  children,
  icon,
  title,
  description,
  to,
}: Props) {
  return (
    <Link to={to} className="button-card">
      {children ? (
        <div className="button-card__inner">{children}</div>
      ) : (
        <div className="button-card__inner">
          <header>
            {icon && typeof icon == "string" ? (
              <img alt="icon" src={icon} width={24} />
            ) : (
              icon
            )}
            <h3>{title}</h3>
          </header>
          <p
            className={
              icon
                ? "button-card__description-with-icon"
                : "button-card__description-without-icon"
            }
          >
            {description}
          </p>
        </div>
      )}
    </Link>
  );
}
