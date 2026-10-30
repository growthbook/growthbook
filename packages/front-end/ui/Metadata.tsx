import { forwardRef } from "react";
import { Flex } from "@radix-ui/themes";
import { Size } from "@/ui/sizes";
import Text from "@/ui/Text";
import styles from "./Metadata.module.scss";

type Props = {
  label: string;
  value: React.ReactNode | string;
  style?: React.CSSProperties;
  size?: Size<"sm" | "md">;
  /** Label above the value, for a narrow column. Otherwise inline "Label: value". */
  stacked?: boolean;
  /** A stacked row's own button (e.g. its pencil), clicked by the whole row. */
  action?: React.ReactNode;
};

export default forwardRef<HTMLDivElement, Props>(function Metadata(
  { label, value, style, size = "md", stacked, action, ...props },
  ref,
) {
  if (stacked) {
    const content = (
      <>
        <Text weight="regular" color="text-low" size={size}>
          {label}
        </Text>
        {typeof value === "string" ? (
          <Text weight="regular" color="text-high" size={size}>
            {value}
          </Text>
        ) : (
          value
        )}
      </>
    );

    if (!action) {
      return (
        <Flex
          direction="column"
          gap="1"
          align="start"
          style={style}
          {...props}
          ref={ref}
        >
          {content}
        </Flex>
      );
    }
    return (
      <Flex
        align="start"
        gap="2"
        className={styles.actionRow}
        style={style}
        // Hovering the row reveals its action.
        data-reveals-action=""
        {...props}
        ref={ref}
      >
        <Flex
          direction="column"
          gap="1"
          align="start"
          flexGrow="1"
          minWidth="0"
        >
          {content}
        </Flex>
        <span className={styles.action}>{action}</span>
      </Flex>
    );
  }

  return (
    <Flex gap="1" align="center" style={style} {...props} ref={ref}>
      <Text weight="medium" color="text-high" size={size}>
        {label}:
      </Text>
      {typeof value === "string" ? (
        <Text weight="regular" color="text-mid" size={size}>
          {value}
        </Text>
      ) : (
        value
      )}
    </Flex>
  );
});
