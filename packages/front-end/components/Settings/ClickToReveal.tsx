import { useEffect, useRef, useState } from "react";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import { PiCheck, PiCopy } from "react-icons/pi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import styles from "./ClickToReveal.module.scss";

type Props = {
  valueWhenHidden: string;
  getValue: () => Promise<string>;
};

export default function ClickToReveal({ getValue, valueWhenHidden }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const keyRef = useRef<HTMLButtonElement>(null);
  const revealRef = useRef<HTMLButtonElement>(null);
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({});
  const leave = () => {
    setHovered(false);
    setCopied(false);
  };

  // The key appears under the pointer that revealed it, so no mouseenter
  // fires; check once it's laid out.
  useEffect(() => {
    if (!value) return;
    const frame = requestAnimationFrame(() => {
      if (keyRef.current?.matches(":hover")) setHovered(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <Box>
      <Box
        position="relative"
        width="fit-content"
        className={`${styles.frame} ${value ? styles.revealed : styles.hidden}`}
        // Anywhere on the widget reveals, through the button so it shows the wait.
        onClick={(e) => {
          if (!revealRef.current?.contains(e.target as Node)) {
            revealRef.current?.click();
          }
        }}
      >
        {value && !copySupported ? (
          // With no clipboard, the whole key shows so it can be copied by hand.
          <code className={styles.fullKey}>{value}</code>
        ) : (
          <span className={value ? styles.sizer : styles.blurText} aria-hidden>
            {valueWhenHidden}
          </span>
        )}
        {value ? (
          <>
            {copySupported ? (
              <>
                {/* A popover rather than a tooltip, which closes on click and
                  would never show "Copied". */}
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
                      ref={keyRef}
                      type="button"
                      className={styles.key}
                      aria-label="Copy secret"
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
                      <code className={styles.secret}>{value}</code>
                    </button>
                  }
                />
                <VisuallyHidden role="status">
                  {copied && copySuccess ? "Copied" : ""}
                </VisuallyHidden>
              </>
            ) : null}
            <Box
              position="absolute"
              className={`${styles.solidBacking} ${styles.hide}`}
            >
              <Button
                size="sm"
                variant="outline"
                color="gray"
                style={{ height: 20, padding: "0 6px" }}
                onClick={() => setValue(null)}
              >
                <Text size="sm">Hide</Text>
              </Button>
            </Box>
          </>
        ) : (
          <Flex position="absolute" inset="0" align="center" justify="center">
            <Box className={styles.solidBacking}>
              <Button
                ref={revealRef}
                className={styles.reveal}
                size="sm"
                variant="outline"
                color="gray"
                setError={setError}
                onClick={async () => setValue(await getValue())}
              >
                Reveal
              </Button>
            </Box>
          </Flex>
        )}
      </Box>
      {error && <HelperText status="error">{error}</HelperText>}
    </Box>
  );
}
