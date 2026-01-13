import { useCallback, useEffect, useState } from "react";

/**
 * Hook to sync a component's state with the URL hash.
 * If validIds is provided, this hook will only update the URL hash if the new value is in the list of validIds.
 *
 * @param validIds - Array of valid hash values that this component can handle
 * @returns [currentHash, setHash] - Current hash value and function to update it
 *
 * @example
 * ```tsx
 * const tabs = ['info', 'settings', 'advanced'] as const;
 * const [activeTab, setActiveTab] = useURLHash(tabs);
 *
 * // activeTab will automatically update when URL hash changes
 * // setActiveTab will update both state and URL hash
 * return (
 *   <Tabs active={activeTab} onChange={setActiveTab}>
 *     <Tab id="info">Info</Tab>
 *     <Tab id="settings">Settings</Tab>
 *     <Tab id="advanced">Advanced</Tab>
 *   </Tabs>
 * );
 * ```
 */
export default function useURLHash<Id extends string>(
  validIds: Id[] | undefined = undefined,
) {
  const [hash, setHashState] = useState(() => {
    // Get initial hash from URL
    const urlHash = globalThis?.window
      ? window.location.hash.slice(1) || ""
      : "";
    if (validIds === undefined) {
      return urlHash === "" ? undefined : urlHash;
    } else {
      return validIds.includes(urlHash as Id) ? urlHash : validIds[0];
    }
  });

  const setHashAndURL = useCallback(
    (newHash: Id) => {
      if (validIds === undefined || validIds.includes(newHash)) {
        setHashState((currentHash) => {
          if (newHash === currentHash) return currentHash;
          // Use replaceState here as we are just changing the hash
          // eslint-disable-next-line no-restricted-syntax
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${window.location.search}#${newHash}`,
          );
          return newHash;
        });
      }
    },
    [validIds],
  );

  // Listen for URL changes
  useEffect(() => {
    const handler = () => {
      const newHash = window.location.hash.slice(1) || "";
      if (validIds === undefined || validIds.includes(newHash as Id)) {
        setHashState(newHash === "" ? undefined : newHash);
      }
    };

    if (globalThis?.window) {
      window.addEventListener("hashchange", handler, false);
    }
    return () => {
      if (globalThis?.window) {
        window.removeEventListener("hashchange", handler, false);
      }
    };
  }, [validIds]);

  return [hash, setHashAndURL] as const;
}
