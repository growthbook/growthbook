const script = document.createElement("script");
script.src = "https://widget.kapa.ai/kapa-widget.bundle.js";
script.async = true;
script.setAttribute("data-website-id", "c4406b9f-35c5-43ca-b0c1-e7c0e261831f");
script.setAttribute("data-user-analytics-cookie-enabled", "false");
script.setAttribute("data-project-name", "GrowthBook");
script.setAttribute("data-project-color", "#6550b9");
script.setAttribute(
  "data-modal-example-questions",
  "How do I create a feature flag?, How do I run an experiment?",
);
script.setAttribute("data-project-logo", "/static/img/gb-logo-white.svg");
script.setAttribute("data-modal-image", "/static/img/gb-logo-ai.svg");
script.setAttribute("data-button-width", "72px");
script.setAttribute("data-button-height", "72px");
document.head.appendChild(script);
