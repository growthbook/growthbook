import { FC } from "react";
import Callout from "@/ui/Callout";

export const EventForwarderManagedCallout: FC<{ show: boolean }> = ({
  show,
}) => {
  if (!show) {
    return null;
  }

  return (
    <Callout status="info" mb="4">
      Managed by the Event Forwarder. Saving any edit takes ownership and stops
      automatic updates.
    </Callout>
  );
};
