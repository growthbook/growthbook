import { Flex, IconButton, Callout as RadixCallout } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiArrowSquareOut, PiLightbulb, PiX } from "react-icons/pi";
import { forwardRef, ReactNode } from "react";
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

export default forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    status: Status;
    size?: "sm" | "md";
    id: string;
    docSection?: DocSection;
    renderWhenDismissed?: (undismiss: () => void) => React.ReactElement;
  } & MarginProps
>(function DismissableCallout(
  {
    children,
    status,
    docSection,
    id,
    renderWhenDismissed,
    size = "md",
    ...containerProps
  },
  ref
) {
  const [dismissed, setDismissed] = useLocalStorage(
    `dismissable-callout:${id}`,
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
        ref={ref}
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
            {link ? <div style={{ flex: 1 }}>{link}</div> : null}
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
});
