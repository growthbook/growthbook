import { Flex, IconButton, Callout as RadixCallout } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiArrowSquareOut, PiLightbulb, PiX } from "react-icons/pi";
import { DocLink, DocSection } from "@/components/DocLink";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { getRadixSize } from "./Callout";
import styles from "./RadixOverrides.module.scss";
import { Status, getRadixColor } from "./HelperText";

export type Props = {
  id: string;
  renderWhenDismissed?: (undismiss: () => void) => React.ReactElement;
  children: React.ReactNode;
  docSection?: DocSection;
  size?: "sm" | "md";
  status: Status;
} & MarginProps;

export default function DismissableCallout({
  id,
  children,
  docSection,
  renderWhenDismissed,
  size = "md",
  status,
  ...containerProps
}: Props) {
  const [dismissed, setDismissed] = useLocalStorage(
    `premium-callout:${id}`,
    false
  );

  if (dismissed)
    return renderWhenDismissed
      ? renderWhenDismissed(() => setDismissed(false))
      : null;

  const link = docSection ? (
    <DocLink docSection={docSection} useRadix={true}>
      View docs <PiArrowSquareOut size={15} />
    </DocLink>
  ) : null;

  return (
    <>
      <RadixCallout.Root
        className={styles.callout}
        color={getRadixColor(status)}
        role={status === "error" ? "alert" : undefined}
        size={getRadixSize(size)}
        {...containerProps}
        style={{
          position: "relative",
        }}
      >
        <RadixCallout.Icon>
          <PiLightbulb size={15} />
        </RadixCallout.Icon>
        <RadixCallout.Text size="2">
          <Flex align="start" gap="1" pr="3">
            <div>{children}</div>
            <div style={{ flex: 1 }}>{link}</div>
          </Flex>
        </RadixCallout.Text>

        <IconButton
          variant="ghost"
          color="gray"
          size="1"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            marginTop: -11,
          }}
        >
          <PiX />
        </IconButton>
      </RadixCallout.Root>
    </>
  );
}
