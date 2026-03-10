import { useCallback, useEffect, useState } from "react";

type CopyToClipboardOptions = {
  timeout?: number; // ms before copySuccess flips back; -1 = never (default)
};

type UseCopyToClipboard = {
  copySupported: boolean;
  copySuccess: boolean;
  performCopy: (value: string) => void;
};

export const useCopyToClipboard = ({
  timeout = -1,
}: CopyToClipboardOptions): UseCopyToClipboard => {
  const [supported, setSupported] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator?.clipboard?.writeText === "function"
    ) {
      setSupported(true);
    }
  }, []);

  const performCopyToClipboard = useCallback(
    async (value: string) => {
      if (!supported) return;

      try {
        await navigator.clipboard.writeText(value);
        setSuccess(true);
      } catch (e) {
        console.error(e);
        setSuccess(false);
      }
    },
    [supported],
  );

  useEffect(
    function flipSuccessAfterDelay() {
      if (timeout === -1 || !success) return;

      const timer = window.setTimeout(() => {
        setSuccess(false);
      }, timeout);

      return () => window.clearTimeout(timer);
    },
    [success, timeout],
  );

  return {
    copySupported: supported,
    copySuccess: success,
    performCopy: performCopyToClipboard,
  };
};
