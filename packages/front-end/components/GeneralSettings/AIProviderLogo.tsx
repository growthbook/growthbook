import React from "react";
import { Flex } from "@radix-ui/themes";
import { AIProvider, AI_PROVIDER_META } from "shared/ai";

/**
 * Badge identifying an AI provider. GrowthBook does not ship third-party brand
 * marks, so this renders a brand-colored initial by default. Point
 * `AI_PROVIDER_META[provider].logo` at a file under `public/` to swap in a real
 * logo — no change needed here.
 */
export default function AIProviderLogo({
  provider,
  size = 28,
}: {
  provider: AIProvider;
  size?: number;
}) {
  const { label, brandColor, logo } = AI_PROVIDER_META[provider];

  if (logo) {
    return (
      <img
        src={logo}
        alt={label}
        title={label}
        width={size}
        height={size}
        style={{ borderRadius: 6, objectFit: "contain" }}
      />
    );
  }

  return (
    <Flex
      align="center"
      justify="center"
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        backgroundColor: brandColor,
        flexShrink: 0,
      }}
    >
      {/* A decorative glyph rather than body copy, so it's a plain span with
          inline styles instead of a design-system Text. */}
      <span
        style={{
          color: "#fff",
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    </Flex>
  );
}
