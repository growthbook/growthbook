import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useFeatureIsOn, useGrowthBook } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import PylonLoader from "@/components/Auth/PylonLoader";
import InAppHelp from "@/components/Auth/legacy/InAppHelp";
import Layout from "./Layout";
import LayoutLite from "./LayoutLite";
import LegacyLayout from "./legacy/Layout";
import LegacyLayoutLite from "./legacy/LayoutLite";
import { NewAppShellContext, useNewAppShell } from "./newAppShellContext";

export { useNewAppShell };

// Past this, with the user and org loaded, the old shell renders.
const DECISION_TIMEOUT_MS = 400;
// Sets the new shell's sizes in global.scss.
const NEW_SHELL_CLASS = "app-shell-new";

// Decides once per mount; ProtectedPage remounts it with each org.
export function AppShellProvider({
  organizationRequired,
  children,
}: {
  // Pages that render without an org have no shell and keep the old sizes.
  organizationRequired: boolean;
  children: ReactNode;
}) {
  const growthbook = useGrowthBook();
  const flagOn = useFeatureIsOn("new-app-shell");
  const { ready: userReady, hashedOrganizationId } = useUser();
  const { orgId, organizations } = useAuth();
  const [newShell, setNewShell] = useState<boolean | null>(null);
  const decided = useRef(false);

  const orgKnown =
    !!userReady &&
    (orgId ? hashedOrganizationId !== "" : !organizations?.length);
  // UserContext gives the SDK the org's attributes in an effect, after the
  // org loads, so the flag is only targeted once the SDK holds them.
  const attributesApplied =
    hashedOrganizationId === "" ||
    growthbook.getAttributes().organizationId === hashedOrganizationId;
  const decidable = orgKnown && growthbook.ready && attributesApplied;

  const decide = useCallback(
    (on: boolean) => {
      if (decided.current) return;
      decided.current = true;
      // Before the shell renders, so nothing under it measures the wrong
      // header; the effect below only keeps it in step.
      document.documentElement.classList.toggle(
        NEW_SHELL_CLASS,
        on && organizationRequired,
      );
      setNewShell(on);
    },
    [organizationRequired],
  );

  useEffect(() => {
    if (decidable) decide(flagOn);
  }, [decidable, flagOn, decide]);

  useEffect(() => {
    if (!orgKnown || newShell !== null) return;
    const timer = window.setTimeout(() => decide(false), DECISION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [orgKnown, newShell, decide]);

  useEffect(() => {
    if (newShell === null) return;
    const root = document.documentElement;
    root.classList.toggle(NEW_SHELL_CLASS, newShell && organizationRequired);
    return () => root.classList.remove(NEW_SHELL_CLASS);
  }, [newShell, organizationRequired]);

  return (
    <NewAppShellContext.Provider value={newShell}>
      {children}
    </NewAppShellContext.Provider>
  );
}

export function AppShellGate({ children }: { children: ReactNode }) {
  return useNewAppShell() === null ? <LoadingOverlay /> : <>{children}</>;
}

export function AppShellLayout({ lite }: { lite: boolean }) {
  const newShell = useNewAppShell();
  if (newShell === null) return null;
  if (lite) return newShell ? <LayoutLite /> : <LegacyLayoutLite />;
  return newShell ? <Layout /> : <LegacyLayout />;
}

export function AppShellHelp() {
  const newShell = useNewAppShell();
  if (newShell === null) return null;
  return newShell ? <PylonLoader /> : <InAppHelp />;
}
