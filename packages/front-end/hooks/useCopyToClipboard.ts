import { useCallback, useEffect, useState } from "react";

type CopyToClipboardOptions = {
  /**
   * Optional delay to flip the success flag back to false. Useful for toggling UI elements.
   * Pass -1 to not flip the success flag back.
   * (default: -1)
   */
  timeout?: number;
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
    [supported]
  );

  useEffect(
    function flipSuccessAfterDelay() {
      if (timeout === -1) return;

      if (success) {
        const timer = window.setTimeout(() => {
          setSuccess(false);
        }, timeout);

        return () => {
          window.clearTimeout(timer);
        };
      }
    },
    [success, timeout]
  );

  return {
    copySupported: supported,
    copySuccess: success,
    performCopy: performCopyToClipboard,
  };
};
