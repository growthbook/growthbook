import { useEffect } from "react";
import { isCloud } from "@/services/env";

type PylonApi = (command: string, ...args: unknown[]) => void;

// Always read at call time: the bootstrap shim is swapped out once the real script loads.
const pylon: PylonApi = (...args) =>
  (window as unknown as { Pylon?: PylonApi }).Pylon?.(...args);

const isLoaded = () => !!(window as unknown as { Pylon?: PylonApi }).Pylon;

export default function PylonChatVisibility({ hidden }: { hidden: boolean }) {
  useEffect(() => {
    if (!isCloud()) return;

    if (!hidden) {
      pylon("showChatBubble");
      return;
    }

    const hide = () => {
      pylon("hide");
      pylon("hideChatBubble");
      pylon("onShow", () => pylon("hide"));
    };

    const restore = () => {
      pylon("onShow", null);
      pylon("showChatBubble");
    };

    if (isLoaded()) {
      hide();
      return restore;
    }

    // Pylon's script may not have loaded yet; poll until it appears.
    let resolved = false;
    const intervalId = window.setInterval(() => {
      if (isLoaded()) {
        window.clearInterval(intervalId);
        resolved = true;
        hide();
      }
    }, 250);
    const timeoutId = window.setTimeout(
      () => window.clearInterval(intervalId),
      10000,
    );

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      if (resolved) restore();
    };
  }, [hidden]);

  return null;
}
