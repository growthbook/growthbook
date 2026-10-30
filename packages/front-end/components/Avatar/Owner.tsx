import { Flex } from "@radix-ui/themes";
import type { Size } from "@/ui/Avatar";
import Text, { TextProps } from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";
import UserAvatar from "./UserAvatar";

export type Props = {
  ownerId?: string;
  gap?: "1" | "2" | "3";
  size?: Size;
  textColor?: TextProps["color"];
  textSize?: TextProps["size"];
  weight?: "regular" | "medium";
  /** Cut a long name short rather than wrap it beside the avatar. */
  truncate?: boolean;
};

export default function Owner({
  ownerId,
  gap = "2",
  size = "sm",
  textColor,
  textSize,
  weight = "regular",
  truncate = false,
}: Props) {
  const { getOwnerDisplay } = useUser();
  const trimmed = ownerId?.trim();
  const display = trimmed ? getOwnerDisplay(trimmed) : "";

  return (
    <Flex
      align="center"
      gap={gap}
      display="inline-flex"
      minWidth={truncate ? "0" : undefined}
    >
      <UserAvatar name={display} size={size} variant="soft" />
      <Tooltip content={display} enabled={truncate && !!display}>
        <Text
          weight={weight}
          color={textColor}
          size={textSize}
          truncate={truncate}
        >
          {display || "None"}
        </Text>
      </Tooltip>
    </Flex>
  );
}
