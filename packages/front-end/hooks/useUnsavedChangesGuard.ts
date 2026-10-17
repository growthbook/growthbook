import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

/**
 * While there are unsaved changes, links off the page ask first and closing or
 * reloading the tab warns. Same-page links (tabs, anchors) pass through.
 * `onLeave` runs once the user confirms, before navigating away.
 */
export default function useUnsavedChangesGuard(
  hasUnsavedChanges: boolean,
  onLeave?: () => void,
) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const navigationConfirmed = useRef(false);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (navigationConfirmed.current) return;
      event.preventDefault();
      event.returnValue = "You have unsaved changes.";
    };
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;

      const link = event.target.closest("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download")
      )
        return;

      const destination = new URL(link.href);
      if (destination.protocol !== "http:" && destination.protocol !== "https:")
        return;
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(destination.href);
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [hasUnsavedChanges]);

  const confirmNavigation = async () => {
    if (!pendingHref) return;
    navigationConfirmed.current = true;
    setPendingHref(null);
    onLeave?.();
    try {
      await router.push(pendingHref);
    } finally {
      navigationConfirmed.current = false;
    }
  };

  return {
    pendingHref,
    confirmNavigation,
    cancelNavigation: () => setPendingHref(null),
  };
}
