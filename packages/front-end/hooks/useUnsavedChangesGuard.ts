import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { createNavigationCancellation } from "@/components/FactTables/MetricEditor/navigationCancellation";

function pathnameOf(url: string) {
  return new URL(url, window.location.origin).pathname;
}

/**
 * While there are unsaved changes, leaving the page (links, Back, router
 * navigation) asks first and closing or reloading the tab warns. Same-page
 * changes (tabs, anchors) pass through. `onLeave` runs once the user confirms,
 * before navigating away.
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

    // Back/forward and router.push. Anchor clicks never get here: onClick
    // stops them before Next sees them. Compared against the router rather
    // than the address bar, which Back has already changed.
    const cancellation = createNavigationCancellation();
    const onRouteChangeStart = (url: string, options: { shallow: boolean }) => {
      if (navigationConfirmed.current) return;
      if (pathnameOf(url) === pathnameOf(router.asPath)) return;
      setPendingHref(url);
      router.events.emit("routeChangeError", cancellation.error, url, options);
      // Next's pages router only cancels a route change when a handler throws.
      throw cancellation.error;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    router.events.on("routeChangeStart", onRouteChangeStart);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      router.events.off("routeChangeStart", onRouteChangeStart);
      cancellation.dispose();
    };
  }, [hasUnsavedChanges, router.asPath, router.events]);

  const allowUnload = useCallback(() => {
    navigationConfirmed.current = true;
  }, []);

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
    allowUnload,
  };
}
