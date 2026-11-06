import { ComponentProps, useEffect, useId, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import styles from "./NewNavigationIntroModal.module.scss";

const PREVIEW_PARAM = "nav-intro";
const IMAGE_SRC = "/images/announcements/new-navigation.webp";
const OPEN_DELAY_MS = 500;

/**
 * Introduces the new navigation (side nav and docked AI assistant).
 *
 * For now it only opens as a preview, with ?preview=nav-intro in the URL, so
 * it can't reach real users by accident. The real trigger is for engineering
 * to decide: e.g. the first app load after login, landing on Home, existing
 * users only (not those who never saw the old header), once per user, and not
 * alongside the NPS survey.
 */
export default function NewNavigationIntroModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Opens a moment after the page, so the new layout shows first; Modal's own
  // animation (Radix's: the backdrop fades, the modal fades and rises) brings
  // it in. With reduced motion there's no animation, so no wait either.
  useEffect(() => {
    if (!router.isReady || router.query.preview !== PREVIEW_PARAM) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOpen(true);
      return;
    }
    // Loads the image meanwhile, so it's there as the modal comes in.
    new Image().src = IMAGE_SRC;
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [router.isReady, router.query.preview]);

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
      onOpenChange={setOpen}
      size="md"
      // "OK, got it", Escape and clicking outside all close it.
      dismissible
      // Described by the body instead (onOpenAutoFocus).
      hasDescription={false}
      onOpenAutoFocus={onOpenAutoFocus}
      // Not tracked while it's preview-only.
      trackingEventModalType=""
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
              New Navigation
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
        <Button onClick={() => setOpen(false)}>OK, got it</Button>
      </Flex>
    </Modal.Root>
  );
}
