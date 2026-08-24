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
import { useUser } from "@/services/UserContext";

// How long a dismissed banner stays hidden before re-showing.
const DISMISS_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

export type MarketingBannerProps = {
  /** Unique id — also used as the localStorage key for dismissal */
  id: string;
  /** Optional short pill label, e.g. "New" or "Private beta"; hidden when empty */
  pill?: string;
  title: string;
  /** Optional sub-line; hidden when empty */
  subheader?: string;
  /** Optional CTA button; hidden when absent */
  cta?: { copy: string; link: string };
  /** Open the CTA in a new tab (external marketing URLs). Default true. */
  external?: boolean;
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
  dismissible = true,
  icon,
}: MarketingBannerProps) {
  // Store when the banner was dismissed so it re-shows after the window below,
  // rather than staying hidden forever.
  const [dismissedAt, setDismissedAt] = useLocalStorage<number | null>(
    `marketing-banner:${id}`,
    null,
  );

  const dismissed =
    typeof dismissedAt === "number" &&
    Date.now() - dismissedAt < DISMISS_DURATION_MS;

  if (dismissible && dismissed) return null;

  return (
    <Callout status="info" icon={null} mb="5">
      <Flex align="center" gap="4" wrap="wrap">
        <Flex align="center" gap="3" flexGrow="1" style={{ minWidth: 0 }}>
          {pill ? (
            <Badge
              label={pill}
              color="violet"
              variant="soft"
              radius="full"
              size="sm"
            />
          ) : null}
          <Box style={{ minWidth: 0, lineHeight: 1.4 }}>
            <Heading as="h6" size="xs" mb="1" color="text-high">
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
              <Text as="div" size="sm" color="text-mid">
                {subheader}
              </Text>
            ) : null}
          </Box>
        </Flex>
        {cta ? (
          <LinkButton
            href={cta.link}
            external={external}
            color="inherit"
            size="md"
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
              onClick={() => setDismissedAt(Date.now())}
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

// Flat on purpose: the flag's Simple Schema only supports primitive fields, so
// a nested `button` object would force the raw-JSON editor. Keeping the CTA as
// two top-level strings lets editors fill the banner in via form inputs.
type MarketingBannerConfig = {
  title: string;
  subheader?: string;
  pill?: string;
  buttonCopy: string;
  buttonLink: string;
  dismissible?: boolean;
  maxUserAgeDays?: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isWithinUserAgeWindow({
  userDateCreated,
  maxUserAgeDays,
  now = Date.now(),
}: {
  userDateCreated?: string | null;
  maxUserAgeDays?: number;
  now?: number;
}): boolean {
  if (typeof maxUserAgeDays !== "number" || maxUserAgeDays <= 0) return true;
  const created = userDateCreated ?? null;
  if (created === null) return false;

  const createdAt = new Date(created).getTime();
  if (Number.isNaN(createdAt)) return false;

  return now - maxUserAgeDays * MS_PER_DAY <= createdAt;
}

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
 * Requires a title and a complete button (both buttonCopy and buttonLink).
 * Everything else — pill, subheader, dismissible, maxUserAgeDays — is optional
 * and degrades gracefully.
 * Returns null when a required field is missing or the flag is unset.
 */
export function HomeMarketingBanner() {
  const config = useFeatureValue<MarketingBannerConfig | null>(
    "home-marketing-banner",
    null,
  );
  const { dateCreated } = useUser();

  const cta =
    config?.buttonCopy && config?.buttonLink
      ? { copy: config.buttonCopy, link: config.buttonLink }
      : undefined;

  if (!config?.title || !cta) return null;

  if (
    !isWithinUserAgeWindow({
      userDateCreated: dateCreated,
      maxUserAgeDays: config.maxUserAgeDays,
    })
  ) {
    return null;
  }

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
