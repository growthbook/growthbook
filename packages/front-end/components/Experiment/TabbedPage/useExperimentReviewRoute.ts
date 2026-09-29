import { useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import track from "@/services/track";
import type { ExperimentTab } from ".";

export const REVIEW_TAB_PATH = "review";

function navigate(
  router: ReturnType<typeof useRouter>,
  method: "push" | "replace",
  hash: string,
) {
  const newUrl = window.location.href.replace(/#.*/, "") + "#" + hash;
  if (newUrl === window.location.href) return;
  router[method](newUrl, undefined, { shallow: true }).catch((e) => {
    if (!e.cancelled) throw e;
  });
}

/**
 * The review is a sub-path of Setup, `#overview/review`: only the tab name is
 * stored, so a reload without the hash never reopens it.
 */
export default function useExperimentReviewRoute({
  tab,
  tabPath,
  setTab,
  setTabPath,
  reviewable,
}: {
  tab: ExperimentTab;
  tabPath: string;
  setTab: (tab: ExperimentTab) => void;
  setTabPath: (path: string) => void;
  reviewable: boolean;
}) {
  const router = useRouter();
  const reviewRequested = tab === "overview" && tabPath === REVIEW_TAB_PATH;
  // Decided at render, so a stale link never flashes the review.
  const reviewing = reviewRequested && reviewable;

  // Replace, never push: a pushed entry would send Back straight here again.
  useEffect(() => {
    if (!reviewRequested || reviewable) return;
    setTabPath("");
    navigate(router, "replace", "overview");
  }, [reviewRequested, reviewable, setTabPath, router]);

  // Pushed, so browser Back leaves the review.
  const openReview = useCallback(
    (source: string) => {
      setTab("overview");
      setTabPath(REVIEW_TAB_PATH);
      navigate(router, "push", `overview/${REVIEW_TAB_PATH}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      track("Open experiment review", { source });
    },
    [setTab, setTabPath, router],
  );

  return { reviewing, openReview };
}
