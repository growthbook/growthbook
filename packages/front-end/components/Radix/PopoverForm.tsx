import React from "react";
import { Flex, Popover as RadixPopover } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import Callout from "@/components/Radix/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
import Portal from "@/components/Modal/Portal";

export interface Props {
  children: React.ReactNode;
  onSubmit?: () => Promise<void>;
  close: () => void;
  width?: string;
  disable?: boolean;
}

export default function PopoverForm({
  children,
  onSubmit,
  close,
  width,
  disable,
  ...otherProps
}: Props & MarginProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <RadixPopover.Root open={true} onOpenChange={() => close()} {...otherProps}>
      <RadixPopover.Trigger>
        <a href="#"></a>
      </RadixPopover.Trigger>
      <Portal>
        <RadixPopover.Content width={width}>
          {loading && <LoadingOverlay />}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (disable) return;
              if (loading) return;
              if (onSubmit) {
                setLoading(true);
                setError(null);
                onSubmit()
                  .then(() => {
                    close();
                  })
                  .catch((err) => {
                    setError(err.message);
                  })
                  .finally(() => {
                    setLoading(false);
                  });
              } else {
                close();
              }
            }}
          >
            {children}
            {error && (
              <Callout status="error" mt="2">
                {error}
              </Callout>
            )}
            <Flex mt="3" align="center" justify="end" gap="3">
              <Button variant="ghost" onClick={() => close()}>
                Cancel
              </Button>
              <Button variant="solid" type="submit" disabled={disable}>
                Submit
              </Button>
            </Flex>
          </form>
        </RadixPopover.Content>
      </Portal>
    </RadixPopover.Root>
  );
}
