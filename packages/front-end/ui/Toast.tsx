import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import * as RadixToast from "@radix-ui/react-toast";
import { IconButton } from "@radix-ui/themes";
import { PiXBold } from "react-icons/pi";
import { RadixStatusIcon } from "./HelperText";
import styles from "./Toast.module.scss";

// Toasts: short, self-dismissing confirmations of an action ("Changes
// saved"). Built on Radix's Toast primitive (@radix-ui/react-toast), styled
// with our tokens; Radix Themes has no toast of its own.
//
// Mount <ToastProvider> once, near the root (pages/_app.tsx). Then:
//
//   const toast = useToast();
//   toast("Changes saved");
//   toast("Couldn't save changes", { status: "error" });
//
// Radix handles the rest: toasts dismiss after `duration` (paused while
// hovered, focused or the window is in the background), can be swiped
// away, are announced to screen readers, and F8 moves focus to them.

export type ToastStatus = "success" | "error" | "info";

type ToastOptions = {
  status?: ToastStatus;
  // Milliseconds before it dismisses itself. Default 4000.
  duration?: number;
};

type ToastItem = Required<ToastOptions> & {
  id: number;
  message: ReactNode;
  open: boolean;
};

type ShowToast = (message: ReactNode, options?: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});
const DismissToastsContext = createContext<() => void>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

// Dismisses every toast on screen, with their exit animation. For when
// something takes over their corner, e.g. the Setup page's save bar coming
// up (set in review).
export function useDismissToasts(): () => void {
  return useContext(DismissToastsContext);
}

// A filled circle in the toast's colour with a bold white check: Phosphor's
// filled check circle has a thin check, and its bold one isn't filled, so
// it's drawn here. 13px, set in review.
function SuccessIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path
        d="M4.6 8.3 6.9 10.6 11.4 5.9"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback<ShowToast>((message, options) => {
    const item: ToastItem = {
      id: nextId++,
      message,
      status: options?.status ?? "success",
      duration: options?.duration ?? 4000,
      open: true,
    };
    // At most three on screen; the newest last.
    setToasts((prev) => [...prev.filter((t) => t.open), item].slice(-3));
  }, []);

  const close = useCallback((id: number) => {
    // Closed first, so Radix can play the exit animation; removed after it.
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, open: false } : t)),
    );
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
  }, []);

  const value = useMemo(() => show, [show]);

  // The toasts on screen, read when dismissing them all.
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  const dismissAll = useCallback(() => {
    toastsRef.current.filter((t) => t.open).forEach((t) => close(t.id));
  }, [close]);

  return (
    <ToastContext.Provider value={value}>
      <DismissToastsContext.Provider value={dismissAll}>
        <RadixToast.Provider swipeDirection="right">
          {children}
          {toasts.map((t) => (
            <RadixToast.Root
              key={t.id}
              className={styles.toast}
              data-status={t.status}
              open={t.open}
              duration={t.duration}
              // Errors interrupt; confirmations wait their turn.
              type={t.status === "error" ? "foreground" : "background"}
              onOpenChange={(open) => {
                if (!open) close(t.id);
              }}
            >
              <span className={styles.icon} aria-hidden>
                {/* Success: a filled check circle with a bold white check (set
                in review). Other statuses: the callout's icon for the status
                (RadixStatusIcon, 15px, as at Callout's default size). */}
                {t.status === "success" ? (
                  <SuccessIcon />
                ) : (
                  <RadixStatusIcon status={t.status} size="md" />
                )}
              </span>
              <RadixToast.Description className={styles.message}>
                {t.message}
              </RadixToast.Description>
              <RadixToast.Close asChild>
                {/* FALLBACK: Radix IconButton; @/ui/ has no icon button. */}
                <IconButton
                  className={styles.close}
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="1"
                  aria-label="Dismiss"
                >
                  {/* Bold, set in review. */}
                  <PiXBold size="12" />
                </IconButton>
              </RadixToast.Close>
            </RadixToast.Root>
          ))}
          <RadixToast.Viewport className={styles.viewport} />
        </RadixToast.Provider>
      </DismissToastsContext.Provider>
    </ToastContext.Provider>
  );
}
