import { ReactNode } from "react";
import { AlertDialog, Box, Flex, Text } from "@radix-ui/themes";
import Button, { Color as ButtonColor } from "@/ui/Button";

type Props = {
  title: string;
  content?: ReactNode;
  yesText?: string;
  noText?: string;
  yesColor?: ButtonColor | "primary" | "danger";
  modalState: boolean;
  setModalState: (state: boolean) => void;
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
};

function mapYesColor(color?: Props["yesColor"]): ButtonColor {
  switch (color) {
    case "danger":
      return "red";
    case "gray":
      return "gray";
    case "primary":
    case undefined:
      return "violet";
    default:
      return color as ButtonColor;
  }
}

export default function ConfirmDialog({
  title,
  content,
  yesText = "yes",
  yesColor = "primary",
  noText = "no",
  modalState,
  setModalState,
  onConfirm,
  children,
}: Props) {
  return (
    <AlertDialog.Root open={modalState} onOpenChange={setModalState}>
      <AlertDialog.Content maxWidth="520px">
        <Flex direction="column" gap="4">
          <Box>
            <AlertDialog.Title>
              <Text as="div" weight="medium" size="4">
                {title}
              </Text>
            </AlertDialog.Title>
            <AlertDialog.Description>
              <Text as="div" size="2" color="gray">
                {content}
              </Text>
            </AlertDialog.Description>
          </Box>
          {children ? (
            <Box>
              <Text as="div" size="2">
                {children}
              </Text>
            </Box>
          ) : null}
          <Flex justify="end" gap="3">
            {noText ? (
              <Button
                variant="outline"
                color="gray"
                onClick={() => setModalState(false)}
              >
                {noText}
              </Button>
            ) : null}
            {/* Do not auto-close on confirm to preserve previous behavior */}
            <Button color={mapYesColor(yesColor)} onClick={onConfirm}>
              {yesText}
            </Button>
          </Flex>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
