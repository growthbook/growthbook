import { useCallback, useState } from "react";
import useUnsavedChangesGuard from "@/hooks/useUnsavedChangesGuard";

// Channel changes already have their own discard dialog in each panel, which
// the guard leaves alone since they stay on the same page.
export default function useSlackNavigationGuard() {
  const [dirtyWorkspaces, setDirtyWorkspaces] = useState<Set<string>>(
    new Set(),
  );

  const setWorkspaceDirty = useCallback((teamId: string, dirty: boolean) => {
    setDirtyWorkspaces((current) => {
      if (current.has(teamId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(teamId);
      else next.delete(teamId);
      return next;
    });
  }, []);

  return {
    setWorkspaceDirty,
    ...useUnsavedChangesGuard(dirtyWorkspaces.size > 0),
  };
}
