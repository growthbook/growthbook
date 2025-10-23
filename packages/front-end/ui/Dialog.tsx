import {
  Box,
  Flex,
  Inset,
  Dialog as RadixDialog,
  Separator,
  Text,
} from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import { ReactNode, useRef, useState } from "react";
import Button from "./Button";
import ErrorDisplay from "./ErrorDisplay";

export type Props = {
  open: boolean;
  header: string;
  subheader: string;
  trigger: ReactNode;
  cta?: string;
  ctaEnabled?: boolean;
  size?: Size;
  submit: () => void | Promise<void>;
  close: () => void;
  children: ReactNode;
};

type Size = "md" | "lg";

export function getRadixSize(size: Size): Responsive<"3" | "4"> {
  switch (size) {
    case "md":
      return "3";
    case "lg":
      return "4";
  }
}

function getMaxWidth(size: Size) {
  switch (size) {
    case "md":
      return "500px";
    case "lg":
      return "800px";
  }
}

export default function Dialog({
  open,
  header,
  subheader,
  cta = "Confirm",
  ctaEnabled = true,
  size = "md",
  submit,
  close,
  children,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);

  const scrollToTop = () => {
    setTimeout(() => {
      if (bodyRef.current) {
        bodyRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 50);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await submit();

      setLoading(false);
      close();

      //   if (trackOnSubmit) {
      //     sendTrackingEvent("modal-submit-success");
      //   }
    } catch (e) {
      setError(e.message);
      scrollToTop();
      setLoading(false);
      //   if (trackOnSubmit) {
      //     sendTrackingEvent("modal-submit-error", {
      //       error: truncateString(e.message, 32),
      //     });
      //   }
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={close}>
      <RadixDialog.Content
        size={getRadixSize(size)}
        maxWidth={getMaxWidth(size)}
      >
        <form onSubmit={handleSubmit}>
          <Box p="2">
            <RadixDialog.Title size="4">{header}</RadixDialog.Title>
            {subheader && (
              <RadixDialog.Description size="2" mb="4">
                <Text style={{ color: "var(--color-text-mid)" }}>
                  {subheader}
                </Text>
              </RadixDialog.Description>
            )}
            <Box mt="5">
              {error && <ErrorDisplay error={error} mb="3" />}
              {children}
            </Box>
          </Box>
          <Inset side="x">
            <Separator size="4" my="4" />
          </Inset>
          <Flex gap="3" justify="end">
            <RadixDialog.Close>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            </RadixDialog.Close>
            <Button type="submit" disabled={!ctaEnabled}>
              {cta}
            </Button>
          </Flex>
        </form>
      </RadixDialog.Content>
    </RadixDialog.Root>
  );
}
