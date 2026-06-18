import { Box, Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { ReactNode } from "react";
import { useFeatureValue } from "@growthbook/growthbook-react";
import { PiX } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export type MarketingBannerProps = {
  /** Unique id — also used as the localStorage key for dismissal */
  id: string;
  /** Short pill label, e.g. "New" or "Private beta" */
  pill: string;
  title: string;
  /** Optional sub-line; hidden when empty */
  subheader?: string;
  /** Optional CTA button; hidden when absent */
  cta?: { copy: string; link: string };
  /** Open the CTA in a new tab (external marketing URLs). Default true. */
  external?: boolean;
  /** "feature" = violet announcement, "beta" = teal sign-up */
  tone?: "feature" | "beta";
  /** Whether the user can dismiss it (persists in localStorage). Default true. */
  dismissible?: boolean;
  /** Optional leading icon shown before the title */
  icon?: ReactNode;
};

export default function MarketingBanner({
  id,
  pill,
  title,
  subheader,
  cta,
  external = true,
  tone = "feature",
  dismissible = true,
  icon,
}: MarketingBannerProps) {
  const [dismissed, setDismissed] = useLocalStorage(
    `marketing-banner:${id}`,
    false,
  );
  const badgeColor = tone === "beta" ? "teal" : "violet";

  if (dismissible && dismissed) return null;

  return (
    <Callout
      status="info"
      color={badgeColor}
      icon={null}
      contentsAs="div"
      mb="5"
    >
      <Flex align="center" gap="4" wrap="wrap">
        <Flex align="center" gap="3" flexGrow="1" style={{ minWidth: 0 }}>
          <Badge
            label={pill}
            color={badgeColor}
            variant="soft"
            radius="full"
            size="sm"
          />
          <Box style={{ minWidth: 0, lineHeight: 1.4 }}>
            <Heading as="h6" size="x-small" mb="1" color="text-high">
              {icon ? (
                <Flex as="span" align="center" gap="2">
                  {icon}
                  {title}
                </Flex>
              ) : (
                title
              )}
            </Heading>
            {subheader ? (
              <Text as="div" size="small" color="text-mid">
                {subheader}
              </Text>
            ) : null}
          </Box>
        </Flex>
        {cta ? (
          <LinkButton
            href={cta.link}
            external={external}
            color={badgeColor}
            size="sm"
          >
            {cta.copy}
          </LinkButton>
        ) : null}
        {dismissible ? (
          <Tooltip content="Dismiss">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              style={{ flexShrink: 0 }}
            >
              <PiX />
            </IconButton>
          </Tooltip>
        ) : null}
      </Flex>
    </Callout>
  );
}

type MarketingBannerConfig = {
  title: string;
  subheader?: string;
  pill: string;
  button?: { copy: string; link: string };
  dismissible?: boolean;
};

// Slug derived from the title so changing the banner copy re-shows it to users
// who dismissed the previous one.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Reads the `home-marketing-banner` JSON feature flag and renders the banner.
 * Returns null when required fields are missing or the flag is unset.
 */
export function HomeMarketingBanner() {
  const config = useFeatureValue<MarketingBannerConfig | null>(
    "home-marketing-banner",
    null,
  );

  if (!config?.title || !config?.pill) return null;

  const cta =
    config.button?.copy && config.button?.link ? config.button : undefined;

  // Identity changes when the banner copy changes. The `key` forces a
  // remount so useLocalStorage re-reads the dismissed state from the new
  // slot, rather than carrying a stale `true` over to the new key.
  const id = `home-marketing-banner:${slugify(config.title)}`;

  return (
    <MarketingBanner
      key={id}
      id={id}
      pill={config.pill}
      title={config.title}
      subheader={config.subheader}
      cta={cta}
      dismissible={config.dismissible ?? true}
    />
  );
}
