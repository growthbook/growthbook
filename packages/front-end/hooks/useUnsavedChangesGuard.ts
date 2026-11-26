import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  createNavigationCancellation,
  isNavigationConfirmed,
  runConfirmedNavigation,
} from "@/components/FactTables/MetricEditor/navigationCancellation";

const NO_QUERY: readonly string[] = [];

// The same page, and the same value for each watched query parameter.
function sameView(a: string, b: string, watchQuery: readonly string[]) {
  const ua = new URL(a, window.location.origin);
  const ub = new URL(b, window.location.origin);
  return (
    ua.pathname === ub.pathname &&
    watchQuery.every((k) => ua.searchParams.get(k) === ub.searchParams.get(k))
  );
}

/**
 * While there are unsaved changes, leaving the page asks first and closing the
 * tab warns; same-page changes pass through unless they change a `watchQuery`
 * parameter or go through `confirmThen`. `onLeave` runs on confirm. Pass a
 * stable `watchQuery` array: it's an effect dependency.
 */
export default function useUnsavedChangesGuard(
  hasUnsavedChanges: boolean,
  onLeave?: () => void,
  watchQuery: readonly string[] = NO_QUERY,
) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const navigationConfirmed = useRef(false);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      // A confirmed in-page action is through once nothing is unsaved.
      navigationConfirmed.current = false;
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (navigationConfirmed.current || isNavigationConfirmed()) return;
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
        sameView(destination.href, window.location.href, watchQuery)
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      setPendingAction(null);
      setPendingHref(destination.href);
    };

    // Back/forward and router.push. Anchor clicks never get here: onClick
    // stops them before Next sees them. Compared against the router rather
    // than the address bar, which Back has already changed.
    const cancellation = createNavigationCancellation();
    const onRouteChangeStart = (url: string, options: { shallow: boolean }) => {
      // Another guard's confirmed navigation passes too, so one dialog is enough.
      if (navigationConfirmed.current || isNavigationConfirmed()) return;
      if (sameView(url, router.asPath, watchQuery)) return;
      setPendingAction(null);
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
  }, [hasUnsavedChanges, router.asPath, router.events, watchQuery]);

  const allowUnload = useCallback(() => {
    navigationConfirmed.current = true;
  }, []);

  // An in-page change that would drop the unsaved changes asks first.
  const confirmThen = (action: () => void) => {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    setPendingHref(null);
    setPendingAction(() => action);
  };

  const confirmNavigation = async () => {
    if (pendingAction) {
      // Lets a navigation the action starts through, until nothing is unsaved.
      navigationConfirmed.current = hasUnsavedChanges;
      setPendingAction(null);
      onLeave?.();
      pendingAction();
      return;
    }
    if (!pendingHref) return;
    navigationConfirmed.current = true;
    setPendingHref(null);
    onLeave?.();
    try {
      await runConfirmedNavigation(() => router.push(pendingHref));
    } finally {
      navigationConfirmed.current = false;
    }
  };

  return {
    pendingHref,
    confirmingSwitch: pendingAction !== null,
    confirmThen,
    confirmNavigation,
    cancelNavigation: () => {
      setPendingHref(null);
      setPendingAction(null);
    },
    allowUnload,
  };
}
