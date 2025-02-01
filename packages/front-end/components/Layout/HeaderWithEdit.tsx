import clsx from "clsx";
import { ReactElement } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import Link from "@/components/Radix/Link";
import Button from "@/components/Radix/Button";

export interface Props {
  className?: string;
  containerClassName?: string;
  children: string | ReactElement;
  edit?: () => void;
  additionalActions?: ReactElement;
  editClassName?: string;
  stopPropagation?: boolean;
  disabledMessage?: false | null | undefined | string | ReactElement;
}

export default function HeaderWithEdit({
  children,
  edit,
  additionalActions,
  editClassName = "a",
  className = "h3",
  containerClassName = "mb-2",
  stopPropagation = false,
  disabledMessage = null,
}: Props) {
  return (
    <Box className={containerClassName}>
      <Flex align="start" justify="between" className={clsx(className, "mb-0")}>
        {children}{" "}
        {edit ? (
          <Link
            className={editClassName}
            onClick={(e) => {
              e.preventDefault();
              if (stopPropagation) e.stopPropagation();
              edit();
            }}
          >
            <Button variant="ghost">Edit</Button>
          </Link>
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
