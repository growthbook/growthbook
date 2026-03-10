import { useEffect } from "react";

/**
 * Hook to lock body scroll when a modal or overlay is open.
 * Prevents background content from scrolling while the overlay is visible.
 *
 * @param isLocked - Whether the scroll lock should be active
 *
 * @example
 * ```tsx
 * const MyModal = ({ isOpen }) => {
 *   useBodyScrollLock(isOpen);
 *   return isOpen ? <div>Modal content</div> : null;
 * };
 * ```
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return;

    // Store the original overflow value to restore later
    const originalOverflow = document.body.style.overflow;

    // Lock scroll
    document.body.style.overflow = "hidden";

    // Restore original overflow on unmount or when isLocked changes
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isLocked]);
}
