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

    const hide = () => {
      pylon("hide");
      pylon("hideChatBubble");
      pylon("onShow", () => pylon("hide"));
    };

    const restore = () => {
      pylon("onShow", null);
      pylon("showChatBubble");
    };

    // The bubble only shows once asked, so showing it waits for the script
    // too: asked before it loads, the bubble stays hidden.
    const apply = () => (hidden ? hide() : pylon("showChatBubble"));

    if (isLoaded()) {
      apply();
      return hidden ? restore : undefined;
    }

    // Pylon's script may not have loaded yet; poll until it appears.
    let resolved = false;
    const intervalId = window.setInterval(() => {
      if (isLoaded()) {
        window.clearInterval(intervalId);
        resolved = true;
        apply();
      }
    }, 250);
    const timeoutId = window.setTimeout(
      () => window.clearInterval(intervalId),
      10000,
    );

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      if (hidden && resolved) restore();
    };
  }, [hidden]);

  return null;
}
