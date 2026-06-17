import { useEffect } from "react";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";

type PylonApi = (command: string, ...args: unknown[]) => void;

const getPylon = (): PylonApi | undefined =>
  (window as unknown as { Pylon?: PylonApi }).Pylon;

/**
 * Bridges the site-wide AI assistant panel and the Pylon live chat widget
 * (cloud only). Pylon injects its own DOM with a very high z-index that the
 * panel can't reliably sit above, so while the panel is open we ask Pylon to
 * get out of the way via its JS API, then restore it on close.
 *
 * This lives next to the rest of the Pylon integration (InAppHelp) and is
 * mounted inside AgentPanelProvider so the provider itself stays a plain state
 * container with no third-party widget knowledge. Renders nothing.
 */
export default function PylonChatVisibility() {
  const { open } = useAgentPanel();

  useEffect(() => {
    if (!open) {
      getPylon()?.("showChatBubble");
      return;
    }

    // While the panel is open, hide Pylon's bubble + chat window. Re-hide on
    // `onShow` so an incoming message can't pop the chat back over the panel.
    const hide = (pylon: PylonApi) => {
      pylon("hide"); // close the chat window if the user had it open
      pylon("hideChatBubble");
      pylon("onShow", () => pylon("hide"));
    };

    const pylon = getPylon();
    if (pylon) {
      hide(pylon);
      return () => pylon("onShow", null);
    }

    // Pylon's script may not have loaded yet; poll briefly so a late-loading
    // widget still gets hidden while the panel is already open.
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
      resolved?.("onShow", null);
    };
  }, [open]);

  return null;
}
