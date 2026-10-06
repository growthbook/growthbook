import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";

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
  // The app's modal (@/ui/Modal's parts, as the variation modal), so it has
  // the standard header, body, and footer with its divider (set in review;
  // it was ConfirmDialog, a plain Radix AlertDialog without them). Keep
  // Editing is the primary button. The modal isn't dismissible (no ×, and
  // Escape or a click outside does nothing), so one of the two buttons
  // decides.
  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open) setPendingUrl(null);
      }}
      size="md"
      hasDescription
      trackingEventModalType=""
    >
      <Modal.Header>
        <Modal.Title>Unsaved Changes</Modal.Title>
      </Modal.Header>
      <Modal.Description>
        You have unsaved changes to this experiment.
      </Modal.Description>
      <Modal.Footer>
        <Button
          variant="ghost"
          onClick={() => {
            discard();
            leave(pendingUrl);
          }}
        >
          Leave Without Saving
        </Button>
        <Button onClick={() => setPendingUrl(null)}>Keep Editing</Button>
      </Modal.Footer>
    </Modal.Root>
  );
}
