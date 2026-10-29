import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Button from "@/ui/Button";
import Avatar from "@/ui/Avatar";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import { ICON_PROPERTIES } from "./constants";

type Props = {
  feature: { id: string };
  additionalBadge?: ReactNode;
  children?: ReactNode;
  heading: string;
  onEdit?: () => void;
  canEdit?: boolean;
};

export default function LinkedChange({
  feature,
  canEdit = false,
  additionalBadge,
  children,
  heading,
  onEdit,
}: Props) {
  const { component: Icon, radixColor } = ICON_PROPERTIES["feature-flag"];

  return (
    <Box className="my-3" p="1">
      <Box>
        <Flex gap="3" justify="between">
          <Flex gap="3" align="center">
            <Avatar radius="small" color={radixColor} size="md" variant="soft">
              <Icon />
            </Avatar>
            <Link href={`/features/${feature.id}`}>
              <Heading as="h4" size="sm" weight="medium" mb="0">
                <Flex align="center">
                  {heading}
                  <PiArrowSquareOut className="ml-2" />
                </Flex>
              </Heading>
            </Link>
            {additionalBadge && <Box>{additionalBadge}</Box>}
          </Flex>
          {canEdit && onEdit && (
            <Box>
              <Button variant="ghost" onClick={() => onEdit()}>
                Edit
              </Button>
            </Box>
          )}
        </Flex>
      </Box>
      <Box mt="4">{children}</Box>
    </Box>
  );
}
