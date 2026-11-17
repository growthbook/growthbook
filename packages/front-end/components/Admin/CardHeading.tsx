import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { EditIcon } from "@/ui/ActionIcons";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";

export function EditLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <EditIcon />
    </Link>
  );
}

// A detail card's title, with an edit link when `onEdit` is given
export default function CardHeading({
  title,
  onEdit,
  action,
}: {
  title: string;
  onEdit?: () => void;
  action?: ReactNode;
}) {
  return (
    <Flex align="center" justify="between" mb="3">
      <Heading as="h2" size="md" mb="0">
        {title}
      </Heading>
      {onEdit ? <EditLink label={`Edit ${title}`} onClick={onEdit} /> : action}
    </Flex>
  );
}
