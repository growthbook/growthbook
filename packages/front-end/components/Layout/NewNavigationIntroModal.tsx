import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

const PREVIEW_PARAM = "nav-intro";
const IMAGE_SRC = "/images/announcements/new-navigation.webp";

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
  useEffect(() => {
    if (router.isReady && router.query.preview === PREVIEW_PARAM) {
      setOpen(true);
    }
  }, [router.isReady, router.query.preview]);

  return (
    <Modal.Root
      open={open}
      onOpenChange={setOpen}
      size="md"
      // Got it, Escape and clicking outside all close it.
      dismissible
      // The body is two paragraphs, which Modal.Description can't hold.
      hasDescription={false}
      // Not tracked while it's preview-only.
      trackingEventModalType=""
    >
      {/* Full-bleed and decorative. The gradient stands in until the image
          loads, and keeps the space if it doesn't. */}
      <Box
        flexShrink="0"
        aria-hidden="true"
        style={{
          aspectRatio: "1000 / 472",
          background:
            "linear-gradient(135deg, var(--violet-9), var(--violet-11))",
        }}
      >
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
        <Flex direction="column" gap="1">
          <Box style={{ color: "var(--violet-11)" }}>
            <Text size="sm" weight="medium">
              New Navigation
            </Text>
          </Box>
          <Modal.Title>Less header. More room.</Modal.Title>
        </Flex>
      </Modal.Header>
      <Modal.Body>
        <Flex direction="column" gap="3">
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
      {/* A standard footer's spacing, without its divider line. */}
      <Flex
        flexShrink="0"
        justify="end"
        style={{ padding: "20px var(--space-7)" }}
      >
        <Button onClick={() => setOpen(false)}>Got it</Button>
      </Flex>
    </Modal.Root>
  );
}
