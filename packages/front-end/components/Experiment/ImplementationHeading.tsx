import { ReactNode } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import Text, { TextProps } from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useImplementationTypeChooser } from "@/components/Experiment/ChangeImplementationTypeModal";

/** Labels one kind of implementation on the Setup page: flags, redirects, visual changes. */
export default function ImplementationHeading({
  children,
  action,
  menu,
  inList = false,
  mt = "4",
  mb = "2",
}: {
  children: ReactNode;
  // Right-aligned on the heading's line.
  action?: ReactNode;
  // This heading's own menu items, above the page's "Change implementation type".
  menu?: ReactNode;
  // In a list whose gap already spaces it: pulled up under that gap instead.
  inList?: boolean;
  mt?: TextProps["mt"];
  mb?: TextProps["mb"];
}) {
  const chooseType = useImplementationTypeChooser();
  const hasMenu = !!menu || !!chooseType;
  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      mt={inList ? "2" : mt}
      mb={inList ? "-2" : mb}
    >
      <Text as="div" weight="medium" color="text-low" textTransform="uppercase">
        {children}
      </Text>
      {action || hasMenu ? (
        <Flex align="center" gap="4">
          {action}
          {hasMenu ? (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  // Only the sides: the ghost's vertical pull keeps the row's
                  // height the same with or without the menu.
                  style={{ marginLeft: 0, marginRight: 0 }}
                  aria-label={
                    typeof children === "string"
                      ? `${children} actions`
                      : "Actions"
                  }
                >
                  <BsThreeDotsVertical size={16} />
                </IconButton>
              }
              menuPlacement="end"
              variant="soft"
            >
              {menu}
              {chooseType ? (
                <DropdownMenuItem onClick={() => chooseType()}>
                  Change implementation type
                </DropdownMenuItem>
              ) : null}
            </DropdownMenu>
          ) : null}
        </Flex>
      ) : null}
    </Flex>
  );
}
