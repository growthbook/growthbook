import React, { FC, PropsWithChildren } from "react";
import LinkButton from "@/ui/LinkButton";

type ImportFromServiceCardProps = PropsWithChildren<{
  service: string;
  icon: string;
  path: string;
  accentColor: string;
}>;

export const ImportFromServiceCard: FC<ImportFromServiceCardProps> = ({
  icon,
  service,
  path,
  accentColor,
  children,
}) => {
  return (
    <div className="card p-3">
      <div className="d-flex align-items-center">
        <div
          className="d-flex justify-content-center align-items-center mr-3"
          style={{
            backgroundColor: accentColor,
            width: 60,
            height: 60,
            borderRadius: 6,
          }}
        >
          <img
            src={`/images/3rd-party-logos/importing/icons/${icon}.svg`}
            style={{
              width: 40,
            }}
            alt={`${service} logo`}
          />
        </div>

        <div className="flex-grow-1">
          <h2>{service}</h2>
          <div className="my-2">{children}</div>
        </div>

        <div>
          <LinkButton href={`importing/${path}`} style={{ minWidth: 200 }}>
            Import from {service}
          </LinkButton>
        </div>
      </div>
    </div>
  );
};
