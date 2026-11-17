import { ReactNode } from "react";
import { Separator } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { StatusBadge, StatusBadgeHealth } from "./StatusBadge";

export interface Props {
  id?: string;
  title: string;
  helpText?: string;
  description?: ReactNode;
  children: ReactNode;
  status: StatusBadgeHealth;
}

export default function HealthCard({
  id,
  title,
  helpText,
  description,
  children,
  status,
}: Props) {
  return (
    <div className="appbox my-3 p-3" id={id}>
      <div className="mb-2">
        <h2 className="d-inline">{title}</h2>{" "}
        {status !== "healthy" && <StatusBadge status={status} />}
        <span className="text-muted float-right">{helpText}</span>
        {description ? (
          <Text as="p" mt="1">
            {description}
          </Text>
        ) : null}
      </div>
      <Separator size="4" mt="0" mb="3" />
      <div>{children}</div>
    </div>
  );
}
