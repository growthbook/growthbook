import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiXBold } from "react-icons/pi";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";

// While the Setup page has unsaved changes, leaving it asks first (set in
// review): an "Unsaved Changes" modal to leave without saving or keep
// editing.
//
// What it catches:
//   - Clicking a link to another page (the sidebar, top nav, breadcrumbs,
//     links in the page): caught on the way down, before Next's Link sees
//     it, so nothing navigates until the modal says so.
//   - The browser's back and forward buttons, via Next's beforePopState.
//     Keeping editing puts the experiment's URL back.
//   - Closing the tab, reloading, or typing a new address: browsers only
//     allow their own "Leave site?" prompt there (beforeunload), never a
//     custom modal, so that's what shows.
// Links within the experiment page (its tabs, #hashes) aren't caught: the
// draft stays put across tabs. Navigation the app does itself in code isn't
// caught either.
export default function UnsavedChangesGuard({
  active,
  discard,
}: {
  // There are unsaved changes the page could save.
  active: boolean;
  discard: () => void;
}) {
  const router = useRouter();
  // Where the user was headed, while the modal asks.
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  // Set once they've chosen to leave, so the navigation goes through.
  const leaving = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;
    leaving.current = false;
    const samePage = (url: string) =>
      new URL(url, window.location.href).pathname === window.location.pathname;

    // Link clicks, in the capture phase, ahead of Next's Link handler.
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (samePage(url.href)) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingUrl(url.pathname + url.search + url.hash);
    };

    // Back / forward: hold the navigation and ask.
    router.beforePopState(({ as }) => {
      if (leaving.current || !activeRef.current || samePage(as)) return true;
      setPendingUrl(as);
      // The browser has already moved its address; put the experiment's
      // back while the modal asks.
      void router.replace(router.asPath, undefined, { shallow: true });
      return false;
    });

    // Closing, reloading, typing an address: the browser's own prompt.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      router.beforePopState(() => true);
    };
  }, [active, router]);

  const leave = (url: string) => {
    leaving.current = true;
    setPendingUrl(null);
    void router.push(url);
  };

  if (!pendingUrl) return null;
  // The app's modal (@/ui/Modal's parts), with the redesigned experiment
  // pages' modal chrome (set in review), as Edit Split % and the Create
  // Experiment modal: a divider under the header, the title as a page
  // heading, a close button at its right, the message in the body in
  // --slate-11, lighter dividers, 32px at the sides, a grey Leave Without
  // Saving, and a soft fade in and out. Keep Editing is the primary button.
  // Escape and a click outside still do nothing; the close button keeps
  // editing, as Keep Editing does.
  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open) setPendingUrl(null);
      }}
      size="md"
      trackingEventModalType=""
      dividerColor="var(--gray-a5)"
      paddingX="var(--space-6)"
      fadeIn
    >
      {/* FALLBACK: Radix IconButton; @/ui/ has no icon button. No height of
        its own, so the trimmed title sets the header's height. */}
      <Modal.Header divider>
        <Modal.Title pageHeading>Unsaved Changes</Modal.Title>
        <Flex align="center" style={{ height: 0, marginLeft: "auto" }}>
          <Modal.Close>
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              size="1"
              aria-label="Close"
            >
              <PiXBold size={16} style={{ color: "var(--slate-10)" }} />
            </IconButton>
          </Modal.Close>
        </Flex>
      </Modal.Header>
      <Modal.Body scrollToEdges>
        {/* Centred between the dividers (set in review): the body's 40px
          below brought up to its 28px above. */}
        <Box
          style={{
            color: "var(--slate-11)",
            marginBottom: "calc(28px - var(--space-7))",
          }}
        >
          <Text as="div" size="md">
            You have unsaved changes to this experiment.
          </Text>
        </Box>
      </Modal.Body>
      <Modal.Footer flushTop>
        {/* As the Create Experiment modal's Cancel: grey, --slate-12 text
          at 400, 6px corners on its hover fill. Leaves straight away. */}
        <Button
          variant="ghost"
          color="gray"
          className={modalStandardStyles.ghostButton}
          style={{
            borderRadius: "var(--radius-3)",
            color: "var(--slate-12)",
          }}
          onClick={() => {
            discard();
            leave(pendingUrl);
          }}
        >
          Leave Without Saving
        </Button>
        {/* Closes through Modal.Close, so the fade-out plays; @/ui/Button's
          default preventDefault would cancel that click. */}
        <Modal.Close>
          <Button preventDefault={false}>Keep Editing</Button>
        </Modal.Close>
      </Modal.Footer>
    </Modal.Root>
  );
}
