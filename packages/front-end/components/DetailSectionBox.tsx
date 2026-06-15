import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";

export function DetailSectionBox({
  title,
  onEdit,
  editLabel = "Edit",
  children,
}: {
  title: string;
  onEdit?: (() => void) | null;
  editLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="box p-4 my-4">
      <Flex align="center" justify="between" mb="4" className="text-dark">
        <h4 className="m-0">{title}</h4>
        {onEdit ? (
          <Button variant="ghost" onClick={onEdit}>
            {editLabel}
          </Button>
        ) : null}
      </Flex>
      {children}
    </div>
  );
}

export function DetailSectionColumn({
  label,
  children,
  width = "col-4",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  width?: string;
  className?: string;
}) {
  return (
    <div className={`${width}${className ? ` ${className}` : ""}`}>
      <div className="h5">{label}</div>
      <div>{children}</div>
    </div>
  );
}
