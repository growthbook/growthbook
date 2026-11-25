import { ReactNode } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { StatusBadge, StatusBadgeHealth } from "./StatusBadge";

export interface Props {
  id?: string;
  title: string;
  helpText?: string;
  description?: ReactNode;
  children: ReactNode;
  status: StatusBadgeHealth;
  action?: ReactNode;
}

export default function HealthCard({
  id,
  title,
  helpText,
  description,
  children,
  status,
  action,
}: Props) {
  return (
    <div className="appbox my-3 p-3" id={id}>
      <div className="mb-2">
        <Flex justify="between" align="start" gap="2">
          <Box>
            <h2 className="d-inline">{title}</h2>{" "}
            {status !== "healthy" && <StatusBadge status={status} />}
          </Box>
          <Flex align="center" gap="2">
            <span className="text-muted">{helpText}</span>
            {action}
          </Flex>
        </Flex>
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
