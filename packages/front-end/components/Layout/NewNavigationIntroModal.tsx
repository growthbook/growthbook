import { ComponentProps, useEffect, useId, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { dismissNavIntro, isNavIntroDue } from "@/services/nav-intro";
import { useUser } from "@/services/UserContext";
import styles from "./NewNavigationIntroModal.module.scss";

const PREVIEW_PARAM = "nav-intro";
const IMAGE_SRC = "/images/announcements/new-navigation.webp";

/**
 * Introduces the new navigation (side nav and docked AI assistant).
 *
 * Opens the first time a browser shows the new shell, for accounts created
 * before it existed. Closing it any way sets a cookie (services/nav-intro),
 * and it doesn't open there again. ?preview=nav-intro opens it regardless,
 * for design and QA.
 */
export default function NewNavigationIntroModal() {
  const router = useRouter();
  // Already loaded: the new shell only renders once the user is (AppShell).
  const { accountCreatedAt } = useUser();
  const [open, setOpen] = useState(false);
  // Opens with the page: the backdrop is there from the start, and the modal
  // comes in a moment later (NewNavigationIntroModal.module.scss). The cookie
  // is read after mount so the server render and first paint agree.
  useEffect(() => {
    if (!router.isReady) return;
    if (
      router.query.preview === PREVIEW_PARAM ||
      isNavIntroDue(accountCreatedAt)
    ) {
      setOpen(true);
    }
  }, [router.isReady, router.query.preview, accountCreatedAt]);

  const onOpenChange = (next: boolean) => {
    if (!next) dismissNavIntro();
    setOpen(next);
  };

  const descriptionId = useId();
  // Focus goes to the dialog itself, so no focus ring shows until you tab. The
  // body's two paragraphs are its description, read out as it opens; Modal's
  // own Description holds only one, so the link is set here, before focusing.
  const onOpenAutoFocus: ComponentProps<
    typeof Modal.Root
  >["onOpenAutoFocus"] = (e) => {
    e.preventDefault();
    const dialog = e.currentTarget as HTMLElement;
    dialog.setAttribute("aria-describedby", descriptionId);
    dialog.focus({ preventScroll: true });
  };

  return (
    <Modal.Root
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      // "OK, got it", Escape and clicking outside all close it.
      dismissible
      // Described by the body instead (onOpenAutoFocus).
      hasDescription={false}
      onOpenAutoFocus={onOpenAutoFocus}
      trackingEventModalType="new-navigation-intro"
    >
      {/* Full-bleed and decorative. The gradient stands in until the image
          loads, and keeps the space if it doesn't. */}
      <Box flexShrink="0" aria-hidden="true" className={styles.image}>
        <img
          src={IMAGE_SRC}
          alt=""
          width={500}
          height={236}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </Box>
      <Modal.Header>
        {/* --space-4 down to the body, rather than Modal.Body's --space-5. */}
        <Flex
          direction="column"
          gap="2"
          style={{ marginBottom: "calc(var(--space-4) - var(--space-5))" }}
        >
          <Box style={{ color: "var(--violet-11)" }}>
            <Text size="sm" weight="medium">
              New navigation
            </Text>
          </Box>
          <Modal.Title>Less header. More room.</Modal.Title>
        </Flex>
      </Modal.Header>
      <Modal.Body>
        <Flex id={descriptionId} direction="column" gap="3">
          <Text as="p" color="text-mid">
            We&apos;ve simplified the header and moved its menus into the side
            navigation, so everything lives in one place. Collapse it any time
            to focus on your work.
          </Text>
          <Text as="p" color="text-mid">
            The AI assistant now docks beside your work, so you can ask
            questions without losing context.
          </Text>
        </Flex>
      </Modal.Body>
      {/* A standard footer's spacing, without its divider line or the space
          above it: the body's own bottom padding separates them. */}
      <Flex
        flexShrink="0"
        justify="end"
        style={{ padding: "0 var(--space-7) 20px" }}
      >
        <Button onClick={() => onOpenChange(false)}>OK, got it</Button>
      </Flex>
    </Modal.Root>
  );
}
