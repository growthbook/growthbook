import { useCallback, useEffect, useState } from "react";

type CopyToClipboardOptions = {
  timeout?: number; // ms before copySuccess flips back; -1 = never (default)
  cooldown?: number; // ms after copy where copyCooldown is true; off by default
};

type UseCopyToClipboard = {
  copySupported: boolean;
  copySuccess: boolean;
  copyCooldown: boolean; // true during cooldown after a successful copy
  // A promise starts the write inside the click and fills it in once ready,
  // so slow-to-build text still counts as part of the user's gesture
  performCopy: (value: string | Promise<string>) => void;
};

export const useCopyToClipboard = ({
  timeout = -1,
  cooldown,
}: CopyToClipboardOptions): UseCopyToClipboard => {
  const [supported, setSupported] = useState(false);
  const [success, setSuccess] = useState(false);
  const [inCooldown, setInCooldown] = useState(false);

  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator?.clipboard?.writeText === "function"
    ) {
      setSupported(true);
    }
  }, []);

  const performCopyToClipboard = useCallback(
    async (value: string | Promise<string>) => {
      if (!supported) return;

      try {
        if (typeof value === "string") {
          await navigator.clipboard.writeText(value);
        } else if (
          typeof ClipboardItem !== "undefined" &&
          typeof navigator.clipboard.write === "function"
        ) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": value.then(
                (text) => new Blob([text], { type: "text/plain" }),
              ),
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(await value);
        }
        setSuccess(true);
      } catch (e) {
        console.error(e);
        setSuccess(false);
      }
    },
    [supported],
  );

  useEffect(
    function clearCooldownAfterDelay() {
      if (!cooldown || cooldown <= 0 || !inCooldown) return;

      const timer = window.setTimeout(() => {
        setInCooldown(false);
      }, cooldown);

      return () => window.clearTimeout(timer);
    },
    [inCooldown, cooldown],
  );

  useEffect(
    function flipSuccessAfterDelay() {
      if (timeout === -1 || !success) return;

      const timer = window.setTimeout(() => {
        setSuccess(false);
        if (cooldown && cooldown > 0) {
          setInCooldown(true);
        }
      }, timeout);

      return () => window.clearTimeout(timer);
    },
    [success, timeout, cooldown],
  );

  return {
    copySupported: supported,
    copySuccess: success,
    copyCooldown: inCooldown,
    performCopy: performCopyToClipboard,
  };
};
