import { Flex } from "@radix-ui/themes";
import type { Size } from "@/ui/Avatar";
import Text, { TextProps } from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import UserAvatar from "./UserAvatar";

export type Props = {
  ownerId?: string;
  gap?: "1" | "2" | "3";
  size?: Size;
  textColor?: TextProps["color"];
  weight?: "regular" | "medium";
};

export default function Owner({
  ownerId,
  gap = "2",
  size = "sm",
  textColor,
  weight = "regular",
}: Props) {
  const { getOwnerDisplay } = useUser();
  const trimmed = ownerId?.trim();
  const display = trimmed ? getOwnerDisplay(trimmed) : "";

  return (
    <Flex align="center" gap={gap} display="inline-flex">
      <UserAvatar name={display} size={size} variant="soft" />
      <Text weight={weight} color={textColor}>
        {display || "None"}
      </Text>
    </Flex>
  );
}
