import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
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
  // Stays "Copied" until the pointer or focus leaves the key.
  const [copied, setCopied] = useState(false);
  const keyRef = useRef<HTMLButtonElement>(null);
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({});
  const leave = () => {
    setHovered(false);
    setCopied(false);
  };

  // The key appears under the pointer that clicked Reveal, so no mouseenter
  // fires; check once it's laid out.
  useEffect(() => {
    if (!value) return;
    const frame = requestAnimationFrame(() => {
      if (keyRef.current?.matches(":hover")) setHovered(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  if (value) {
    return (
      <Box position="relative" className={styles.revealed}>
        {copySupported ? (
          // A popover rather than a tooltip, which closes on click and would
          // never show "Copied".
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
                className={styles.value}
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
                <code className="text-main text-break">{value}</code>
              </button>
            }
          />
        ) : (
          <code className="text-main text-break">{value}</code>
        )}
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
      </Box>
    );
  }

  return (
    <Box>
      <Box position="relative" width="fit-content">
        <span className={styles.blurText}>{valueWhenHidden}</span>
        <Flex position="absolute" inset="0" align="center" justify="center">
          <Box className={styles.solidBacking}>
            <Button
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
      </Box>
      {error && <HelperText status="error">{error}</HelperText>}
    </Box>
  );
}
