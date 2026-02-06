import React, { useState, useCallback, CSSProperties } from "react";
import { Box } from "@radix-ui/themes";

interface ShadowedScrollAreaProps {
  children: React.ReactNode;
  height: string | number;
  style?: CSSProperties;
  shadowColor?: string;
  shadowHeight?: number;
}

export default function ShadowedScrollArea({
  children,
  height,
  style,
  shadowColor = "var(--color-background)",
  shadowHeight = 36,
}: ShadowedScrollAreaProps) {
  const [scrollState, setScrollState] = useState({
    canScrollUp: false,
    canScrollDown: true,
  });

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const canScrollUp = scrollTop > 0;
    const canScrollDown = scrollTop + clientHeight < scrollHeight - 1;
    setScrollState({ canScrollUp, canScrollDown });
  }, []);

  return (
    <div style={{ position: "relative", height, ...style }}>
      {/* Top gradient shadow */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: shadowHeight,
          background: `linear-gradient(to bottom, ${shadowColor}, transparent)`,
          pointerEvents: "none",
          zIndex: 1,
          opacity: scrollState.canScrollUp ? 1 : 0,
          transition: "opacity 0.2s ease",
        }}
      />
      {/* Bottom gradient shadow */}
      {scrollState.canScrollDown && <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: shadowHeight,
          background: `linear-gradient(to top, ${shadowColor}, transparent)`,
          pointerEvents: "none",
          zIndex: 1,
          opacity: scrollState.canScrollDown ? 1 : 0,
          transition: "opacity 0.2s ease",
        }}
      />}
      <Box style={{ height: "100%", overflowX: "hidden" }} onScroll={handleScroll}>
        <Box
          style={{
            height: "100%",
            overflowY: "scroll",
            overflowX: "hidden",
            marginRight: -20,
            paddingRight: 20,
          }}
          onScroll={handleScroll}
        >
          {children}
        </Box>
      </Box>
    </div>
  );
}
