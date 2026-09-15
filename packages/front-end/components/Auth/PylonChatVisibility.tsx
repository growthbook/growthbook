import { useEffect } from "react";
import { isCloud } from "@/services/env";

type PylonApi = (command: string, ...args: unknown[]) => void;

const getPylon = (): PylonApi | undefined =>
  (window as unknown as { Pylon?: PylonApi }).Pylon;

export default function PylonChatVisibility({ hidden }: { hidden: boolean }) {
  useEffect(() => {
    if (!isCloud()) return;

    if (!hidden) {
      getPylon()?.("showChatBubble");
      return;
    }

    const hide = (pylon: PylonApi) => {
      pylon("hide");
      pylon("hideChatBubble");
      pylon("onShow", () => pylon("hide"));
    };

    const restore = (pylon: PylonApi) => {
      pylon("onShow", null);
      pylon("showChatBubble");
    };

    const pylon = getPylon();
    if (pylon) {
      hide(pylon);
      return () => restore(pylon);
    }

    // Pylon's script may not have loaded yet; poll until it appears.
    let resolved: PylonApi | null = null;
    const intervalId = window.setInterval(() => {
      const p = getPylon();
      if (p) {
        window.clearInterval(intervalId);
        resolved = p;
        hide(p);
      }
    }, 250);
    const timeoutId = window.setTimeout(
      () => window.clearInterval(intervalId),
      10000,
    );

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      if (resolved) restore(resolved);
    };
  }, [hidden]);

  return null;
}
