import GetStartedAndHomePage from "@/components/GetStarted";
import LegacyGetStartedAndHomePage from "@/components/GetStarted/legacy";
import { useNewAppShell } from "@/components/Layout/AppShell";

export default function GettingStarted() {
  return useNewAppShell() ? (
    <GetStartedAndHomePage showMarketingBanner />
  ) : (
    <LegacyGetStartedAndHomePage showMarketingBanner />
  );
}
