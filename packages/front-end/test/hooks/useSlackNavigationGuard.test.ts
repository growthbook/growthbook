import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useSlackNavigationGuard from "@/components/SlackIntegrations/useSlackNavigationGuard";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/router", () => ({ useRouter: () => router }));

function clickLink({
  href = "/experiments",
  target = "",
  download = false,
  eventOptions = {},
}: {
  href?: string;
  target?: string;
  download?: boolean;
  eventOptions?: MouseEventInit;
} = {}) {
  const link = document.createElement("a");
  link.href = href;
  link.target = target;
  if (download) link.download = "export.csv";
  const child = document.createElement("span");
  link.appendChild(child);
  document.body.appendChild(link);
  const navigate = vi.fn((event: MouseEvent) => event.preventDefault());
  link.addEventListener("click", navigate);
  act(() => {
    child.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...eventOptions,
      }),
    );
  });
  link.remove();
  return navigate;
}

function unloadIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("Slack unsaved navigation guard", () => {
  beforeEach(() => {
    router.push.mockReset().mockResolvedValue(true);
  });

  afterEach(cleanup);

  it("allows links and unloading when all workspaces are clean", () => {
    const { result } = renderHook(useSlackNavigationGuard);
    expect(clickLink()).toHaveBeenCalledOnce();
    expect(result.current.pendingHref).toBeNull();
    expect(unloadIsBlocked()).toBe(false);
  });

  it("blocks a link before its navigation handler and lets users keep editing", () => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    expect(clickLink()).not.toHaveBeenCalled();
    expect(result.current.pendingHref).toBe(
      new URL("/experiments", window.location.href).href,
    );
    act(() => result.current.cancelNavigation());
    expect(result.current.pendingHref).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(unloadIsBlocked()).toBe(true);
  });

  it("dismisses immediately while confirmed navigation is still pending", async () => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    clickLink();
    let finishNavigation = () => {};
    const navigation = new Promise<boolean>((resolve) => {
      finishNavigation = () => resolve(true);
    });
    router.push.mockReturnValueOnce(navigation);
    act(() => {
      void result.current.confirmNavigation();
    });
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      new URL("/experiments", window.location.href).href,
    );
    expect(result.current.pendingHref).toBeNull();
    expect(unloadIsBlocked()).toBe(false);
    await act(async () => {
      finishNavigation();
      await navigation;
    });
  });

  it("also asks before following an external link in the current tab", () => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    expect(clickLink({ href: "https://example.com/" })).not.toHaveBeenCalled();
    expect(result.current.pendingHref).toBe("https://example.com/");
  });

  it("restores protection when navigation fails", async () => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    clickLink();
    router.push.mockRejectedValueOnce(new Error("Navigation failed"));
    await act(async () => {
      await expect(result.current.confirmNavigation()).rejects.toThrow(
        "Navigation failed",
      );
    });
    expect(result.current.pendingHref).toBeNull();
    expect(unloadIsBlocked()).toBe(true);
    expect(clickLink()).not.toHaveBeenCalled();
    expect(result.current.pendingHref).not.toBeNull();
  });

  it("restores protection when the router cancels navigation", async () => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    clickLink();
    router.push.mockResolvedValueOnce(false);
    await act(() => result.current.confirmNavigation());
    expect(unloadIsBlocked()).toBe(true);
    expect(clickLink()).not.toHaveBeenCalled();
  });

  it("leaves channel switching and same-page anchors to their existing handlers", () => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    expect(
      clickLink({ href: `${window.location.pathname}?channel=another` }),
    ).toHaveBeenCalledOnce();
    expect(clickLink({ href: "#settings" })).toHaveBeenCalledOnce();
    expect(result.current.pendingHref).toBeNull();
  });

  it.each([
    { target: "_blank" },
    { download: true },
    { href: "mailto:support@example.com" },
    { eventOptions: { metaKey: true } },
    { eventOptions: { ctrlKey: true } },
    { eventOptions: { shiftKey: true } },
    { eventOptions: { altKey: true } },
    { eventOptions: { button: 1 } },
  ])("allows link actions that keep the current page: %j", (options) => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    expect(clickLink(options)).toHaveBeenCalledOnce();
    expect(result.current.pendingHref).toBeNull();
  });

  it("keeps warning until every dirty workspace is saved or reset", () => {
    const { result } = renderHook(useSlackNavigationGuard);
    act(() => {
      result.current.setWorkspaceDirty("workspace-a", true);
      result.current.setWorkspaceDirty("workspace-b", true);
    });
    act(() => result.current.setWorkspaceDirty("workspace-a", false));
    expect(unloadIsBlocked()).toBe(true);
    expect(clickLink()).not.toHaveBeenCalled();
    act(() => {
      result.current.cancelNavigation();
      result.current.setWorkspaceDirty("workspace-b", false);
    });
    expect(unloadIsBlocked()).toBe(false);
    expect(clickLink()).toHaveBeenCalledOnce();
  });

  it("removes its listeners on unmount", () => {
    const { result, unmount } = renderHook(useSlackNavigationGuard);
    act(() => result.current.setWorkspaceDirty("workspace-a", true));
    unmount();
    expect(unloadIsBlocked()).toBe(false);
    expect(clickLink()).toHaveBeenCalledOnce();
  });
});
