import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  interceptRouteChanges,
  isNavigationConfirmed,
  runConfirmedNavigation,
} from "@/components/FactTables/MetricEditor/navigationCancellation";

export default function useSlackNavigationGuard() {
  const router = useRouter();
  const [dirtyWorkspaces, setDirtyWorkspaces] = useState<Set<string>>(
    new Set(),
  );
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const hasUnsavedChanges = dirtyWorkspaces.size > 0;

  const setWorkspaceDirty = useCallback((teamId: string, dirty: boolean) => {
    setDirtyWorkspaces((current) => {
      if (current.has(teamId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(teamId);
      else next.delete(teamId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isNavigationConfirmed()) return;
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
      // Channel changes already have their own discard dialog in each panel.
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(destination.href);
    };

    // Catches navigation made in code, e.g. the Settings nav and its search.
    const stopIntercepting = interceptRouteChanges(router.events, (url) => {
      if (new URL(url, window.location.origin).pathname === router.pathname)
        return false;
      setPendingHref(url);
      return true;
    });

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      stopIntercepting();
    };
  }, [hasUnsavedChanges, router]);

  const confirmNavigation = async () => {
    if (!pendingHref) return;
    setPendingHref(null);
    await runConfirmedNavigation(() => router.push(pendingHref));
  };

  return {
    setWorkspaceDirty,
    pendingHref,
    confirmNavigation,
    cancelNavigation: () => setPendingHref(null),
  };
}
