import { FC, useEffect, useState } from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import router from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { AppFeatures } from "@/types/app-features";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import {
  trackNotificationMuted,
  trackNotificationPreferencesChanged,
} from "@/services/track";

const categories = [
  "CHANGE",
  "MENTION",
  "REVIEW",
  "SYSTEM",
  "MARKETING",
  "INTEGRATION",
] as const;

type Cat = (typeof categories)[number];

type PrefsRes = {
  categories: Record<Cat, { inApp: boolean; email?: boolean; slack?: boolean }>;
  digestFrequency: string;
};

const labels: Record<Cat, string> = {
  CHANGE: "Product changes (e.g. watched features)",
  MENTION: "Mentions",
  REVIEW: "Reviews and approvals",
  SYSTEM: "System",
  MARKETING: "Tips and product updates",
  INTEGRATION: "Integrations",
};

const NotificationSettingsPage: FC = () => {
  const gb = useGrowthBook<AppFeatures>();
  const { apiCall } = useAuth();
  const [prefs, setPrefs] = useState<PrefsRes | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gb) return;
    if (!gb.isOn("in-app-notifications")) {
      void router.replace("/settings");
      return;
    }
    void (async () => {
      const p = await apiCall<PrefsRes>("/user/notification-preferences");
      setPrefs(p);
    })().catch(() => {});
  }, [gb, apiCall]);

  const setInApp = (cat: Cat, v: boolean) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        categories: {
          ...prev.categories,
          [cat]: { ...prev.categories[cat], inApp: v },
        },
      };
    });
  };

  const onSave = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await apiCall("/user/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify({ categories: prefs.categories }),
      });
      trackNotificationPreferencesChanged({
        categories: Object.keys(prefs.categories),
      });
    } finally {
      setSaving(false);
    }
  };

  const onMuteMarketing = () => {
    setInApp("MARKETING", false);
    trackNotificationMuted({ category: "MARKETING" });
  };

  if (!gb?.isOn("in-app-notifications")) {
    return <LoadingOverlay />;
  }

  if (!prefs) {
    return <LoadingOverlay />;
  }

  return (
    <Box className="container-fluid pagecontents">
      <Heading as="h1" mb="2">
        Notification settings
      </Heading>
      <Text color="text-low" mb="4">
        Control how you are notified in this organization. Watching features or
        experiments is managed from each resource&apos;s page.
      </Text>

      <Box mb="4" maxWidth="560px">
        {categories.map((cat) => (
          <Flex
            key={cat}
            align="center"
            justify="between"
            py="2"
            style={{ borderBottom: "1px solid var(--gray-a5)" }}
          >
            <div>
              <Text weight="semibold">{cat}</Text>
              <Text as="div" color="text-low">
                {labels[cat]}
              </Text>
            </div>
            <Checkbox
              id={`inapp-${cat}`}
              label="In-app"
              value={prefs.categories[cat]?.inApp ?? true}
              setValue={(v) => setInApp(cat, v)}
            />
          </Flex>
        ))}
      </Box>

      <Flex gap="2" mb="4" wrap="wrap">
        <Button onClick={() => void onSave()} disabled={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
        <Button variant="ghost" onClick={onMuteMarketing}>
          Mute marketing
        </Button>
      </Flex>
    </Box>
  );
};

export default NotificationSettingsPage;
