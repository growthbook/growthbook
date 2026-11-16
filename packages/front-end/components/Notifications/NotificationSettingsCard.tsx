import { ReactNode } from "react";
import Frame from "@/ui/Frame";

export default function NotificationSettingsCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Frame mb="0" px="6" py="4">
      {children}
    </Frame>
  );
}
