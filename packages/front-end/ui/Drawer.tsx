import { ReactNode } from "react";
import { Dialog, Flex, IconButton, ScrollArea } from "@radix-ui/themes";
import { PiX } from "react-icons/pi";
import styles from "./Drawer.module.scss";

// A read-only side drawer: a panel that slides in from the right edge of the
// window, over the page. PROTOTYPE (set in review, for the Details rail's
// Spec viewer); the app had no drawer or side-panel primitive.
//
// Built on the same Radix Themes Dialog as @/ui/Modal, so it behaves like
// one: focus moves into it and stays there, Escape or a click on the
// backdrop closes it, focus returns to what opened it, and the title names
// it for screen readers. Only its place and entrance differ (see
// Drawer.module.scss). A title, a close button, and a scrolling body; no
// footer or form.
export default function Drawer({
  open,
  onOpenChange,
  title,
  width = 560,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  // In px, capped at the window's width.
  width?: number;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        className={styles.drawer}
        style={{ width, maxWidth: "100vw" }}
        aria-describedby={undefined}
      >
        <Flex
          justify="between"
          align="center"
          gap="3"
          flexShrink="0"
          className={styles.header}
        >
          <Dialog.Title
            size="5"
            mb="0"
            style={{
              color: "var(--color-text-high)",
              overflowWrap: "anywhere",
            }}
          >
            {title}
          </Dialog.Title>
          <Dialog.Close>
            <IconButton
              variant="ghost"
              color="gray"
              radius="full"
              size="2"
              aria-label="Close"
            >
              <PiX size={16} />
            </IconButton>
          </Dialog.Close>
        </Flex>
        <ScrollArea type="auto" scrollbars="vertical" className={styles.body}>
          <div className={styles.bodyInner}>{children}</div>
        </ScrollArea>
      </Dialog.Content>
    </Dialog.Root>
  );
}
