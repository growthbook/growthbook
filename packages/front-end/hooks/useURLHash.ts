import { useEffect, useState } from "react";

export default function useURLHash<Id extends string>(validIds: Id[]) {
  const [hash, setHashState] = useState(() => {
    // Get initial hash from URL, defaulting to first valid slug
    const urlHash = window.location.hash.slice(1);
    return validIds.includes(urlHash as Id) ? urlHash : undefined;
  });

  const setHashAndURL = (newHash: Id) => {
    if (validIds.includes(newHash)) {
      window.location.hash = newHash;
    }
  };

  // Listen for URL changes
  useEffect(() => {
    const handler = () => {
      const newHash = window.location.hash.slice(1);
      if (validIds.includes(newHash as Id)) {
        setHashState(newHash);
      }
    };

    window.addEventListener("hashchange", handler, false);
    return () => window.removeEventListener("hashchange", handler, false);
  }, [validIds]);

  return [hash, setHashAndURL] as const;
}
