import { Flex } from "@radix-ui/themes";
import { PiInfoFill } from "react-icons/pi";
import Avatar from "./Avatar";

export default function AvatarStories() {
  return (
    <Flex direction="row" gap="3">
      <Avatar>BF</Avatar>
      <Avatar color="green">
        <PiInfoFill size={25} />
      </Avatar>
      <Avatar size="lg" radius="small">
        <img src="https://app.growthbook.io/logo/growth-book-logomark-white.svg" />
      </Avatar>
      <Avatar color="orange" variant="soft" size="sm">
        sm
      </Avatar>
    </Flex>
  );
}
