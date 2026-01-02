import clsx from "clsx";
import { ReactElement } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";

export interface Props {
  className?: string;
  containerClassName?: string;
  children: string | ReactElement;
  edit?: () => void;
  additionalActions?: ReactElement;
  disabledMessage?: false | null | undefined | string | ReactElement;
}

export default function HeaderWithEdit({
  children,
  edit,
  additionalActions,
  className = "h3",
  containerClassName = "mb-2",
  disabledMessage = null,
}: Props) {
  return (
    <Box className={containerClassName}>
      <Flex align="start" justify="between" className={clsx(className, "mb-0")}>
        {children}{" "}
        {edit ? (
          <Button variant="ghost" onClick={edit}>
            Edit
          </Button>
        ) : disabledMessage ? (
          <span className="ml-1 text-muted">
            <Tooltip body={disabledMessage}>Edit</Tooltip>
          </span>
        ) : null}
        {additionalActions && <div className="ml-1">{additionalActions}</div>}
      </Flex>
    </Box>
  );
}
