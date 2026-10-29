import React, { FC, PropsWithChildren } from "react";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

type ImportFromServiceCardProps = PropsWithChildren<{
  service: string;
  icon: string;
  // Logos with black or white parts ship an `${icon}-dark.svg` for dark mode
  hasDarkIcon: boolean;
  // Services with a self-serve importer link to their import page
  path?: string;
  // Services without one open a "request migration help" modal instead
  onRequest?: () => void;
}>;

export const ImportFromServiceCard: FC<ImportFromServiceCardProps> = ({
  icon,
  service,
  path,
  hasDarkIcon,
  onRequest,
  children,
}) => {
  const { theme } = useAppearanceUITheme();
  const iconFile = hasDarkIcon && theme === "dark" ? `${icon}-dark` : icon;

  return (
    <div className="appbox p-3 mb-0">
      <div className="d-flex align-items-center">
        <div
          className="d-flex justify-content-center align-items-center mr-3"
          style={{
            backgroundColor: "var(--color-panel-solid)",
            width: 60,
            height: 60,
            borderRadius: 6,
            border: "1px solid var(--gray-a5)",
          }}
        >
          <img
            src={`/images/3rd-party-logos/importing/icons/${iconFile}.svg`}
            style={{
              width: 40,
              height: 40,
              objectFit: "contain",
            }}
            alt={`${service} logo`}
          />
        </div>

        <div className="flex-grow-1">
          <h2>{service}</h2>
          <div className="my-2">{children}</div>
        </div>

        <div>
          {path ? (
            <LinkButton href={`importing/${path}`} style={{ minWidth: 200 }}>
              Import from {service}
            </LinkButton>
          ) : (
            <Button
              variant="outline"
              onClick={() => onRequest?.()}
              style={{ minWidth: 200 }}
            >
              Get migration help
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
