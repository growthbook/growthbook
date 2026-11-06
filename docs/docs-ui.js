function labelThemeToggle() {
  const button = document.querySelector(
    'button[aria-label="Change theme preference"], button[aria-label="Switch light or dark mode"]',
  );
  if (!button) {
    return;
  }
  button.setAttribute("title", "Switch light or dark mode");
  button.setAttribute("aria-label", "Switch light or dark mode");
}

function hideMintlifyAssistantChrome() {
  document.querySelectorAll(".chat-assistant-send-button").forEach((el) => {
    const panel =
      el.closest("form") ?? el.closest("section") ?? el.parentElement;
    if (panel && panel.style.display !== "none") {
      panel.style.display = "none";
    }
  });
}

// The app sets gb_last_active on .growthbook.io whenever a signed-in user
// opens it (see packages/front-end/services/last-active-cookie.ts). People
// who've used the app get a single "Open App" button; everyone else gets an
// "Open App" link plus a "Start For Free" button (both go to the app). The
// cookie is a spoofable UI hint only.
function hasUsedApp() {
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith("gb_last_active="));
}

function labelAppCta() {
  const usedApp = hasUsedApp();
  // styles.css hides the separate Open App link when this class is set,
  // since the primary button already says "Open App".
  document.documentElement.classList.toggle("gb-used-app", usedApp);
  const label = usedApp ? "Open App" : "Start For Free";
  const span = document.querySelector(
    'a.bg-primary[href^="https://app.growthbook.io"] span',
  );
  if (span && span.textContent !== label) {
    span.textContent = label;
  }
}

function applyDocsUi() {
  labelThemeToggle();
  hideMintlifyAssistantChrome();
  labelAppCta();
}

let docsUiScheduled = false;
function scheduleDocsUi() {
  if (docsUiScheduled) {
    return;
  }
  docsUiScheduled = true;
  requestAnimationFrame(() => {
    docsUiScheduled = false;
    applyDocsUi();
  });
}

applyDocsUi();
document.addEventListener("click", scheduleDocsUi);
new MutationObserver(scheduleDocsUi).observe(document.body, {
  childList: true,
  subtree: true,
});
