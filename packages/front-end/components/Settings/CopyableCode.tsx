import { useEffect, useRef, useState } from "react";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import clsx from "clsx";
import { PiCheck, PiCopy } from "react-icons/pi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import styles from "./CopyableCode.module.scss";

export default function CopyableCode({
  value,
  muted = false,
  framed = false,
}: {
  value: string;
  muted?: boolean;
  framed?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({});
  const leave = () => {
    setHovered(false);
    setCopied(false);
  };

  // Fade only a value that's cut off; a fade on one that fits would hide its
  // last characters.
  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, copySupported]);

  if (!copySupported) {
    // With no clipboard, the whole value shows so it can be copied by hand.
    return (
      <code className={clsx(styles.fullValue, muted && styles.muted)}>
        {value}
      </code>
    );
  }

  return (
    <Box as="span" className={styles.copyable}>
      {/* A popover rather than a tooltip, which closes on click and would
          never show "Copied". */}
      <Popover
        anchorOnly
        open={hovered}
        onOpenChange={(open) => (open ? setHovered(true) : leave())}
        disableDismiss
        onOpenAutoFocus={(e) => e.preventDefault()}
        side="top"
        contentStyle={{ padding: "4px 8px", pointerEvents: "none" }}
        content={
          <Flex align="center" gap="1">
            {copied && copySuccess ? <PiCheck /> : <PiCopy />}
            <Text size="sm">
              {copied && copySuccess ? "Copied" : "Click to copy"}
            </Text>
          </Flex>
        }
        trigger={
          <button
            type="button"
            className={clsx(styles.value, framed && styles.framed)}
            aria-label={`Copy ${value}`}
            onClick={() => {
              performCopy(value);
              setCopied(true);
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseMove={() => setHovered(true)}
            onMouseLeave={leave}
            onFocus={() => setHovered(true)}
            onBlur={leave}
          >
            <code
              ref={codeRef}
              className={clsx(
                styles.code,
                muted && styles.muted,
                overflowing && styles.overflowing,
              )}
            >
              {value}
            </code>
            {framed &&
              (copied && copySuccess ? (
                <PiCheck aria-hidden />
              ) : (
                <PiCopy aria-hidden />
              ))}
          </button>
        }
      />
      <VisuallyHidden role="status">
        {copied && copySuccess ? "Copied" : ""}
      </VisuallyHidden>
    </Box>
  );
}
