import { FC, useEffect, useState, CSSProperties } from "react";
import { Box } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

const SHOW_TIME = 3000;

type TempMessageProps = {
  close: () => void;
  children: string;
  className?: string;
  style?: CSSProperties;
  delay?: number | null;
};
const TempMessage: FC<TempMessageProps> = ({
  close,
  children,
  className,
  style,
  delay = SHOW_TIME,
}) => {
  const [closing, setClosing] = useState(false);

  // Start closing after delay ms, or keep open for null
  useEffect(() => {
    if (delay !== null) {
      const timer = setTimeout(() => {
        setClosing(true);
      }, delay);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [delay]);

  // Close after waiting for fade out animation to finish
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setClosing(false);
      close();
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [closing]);

  return (
    <Box
      className={className}
      style={{
        transition: "200ms all",
        opacity: closing ? 0 : 1,
        ...style,
      }}
    >
      <Callout status="success">
        <Text as="div" align="center">
          {children}
        </Text>
      </Callout>
    </Box>
  );
};

export default TempMessage;
