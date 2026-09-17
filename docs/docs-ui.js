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

function applyDocsUi() {
  labelThemeToggle();
  hideMintlifyAssistantChrome();
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
