import { Flex } from "@radix-ui/themes";
import type { Size } from "@/ui/Avatar";
import Text, { TextProps } from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import UserAvatar from "./UserAvatar";

export type Props = {
  ownerId?: string;
  gap?: "1" | "2" | "3";
  size?: Size;
  textClassName?: string;
  textColor?: TextProps["color"];
  weight?: "regular" | "medium";
};

export default function Owner({
  ownerId,
  gap = "2",
  size = "sm",
  textClassName,
  textColor,
  weight = "regular",
}: Props) {
  const { getOwnerDisplay } = useUser();
  const trimmed = ownerId?.trim();
  const display = trimmed ? getOwnerDisplay(trimmed) : "";
  const hasOwner = Boolean(trimmed && display);

  return (
    <Flex align="center" gap={gap}>
      <UserAvatar
        name={hasOwner ? display : undefined}
        size={size}
        variant="soft"
      />
      <span className={textClassName}>
        <Text weight={weight} color={textColor}>
          {hasOwner ? display : "None"}
        </Text>
      </span>
    </Flex>
  );
}
