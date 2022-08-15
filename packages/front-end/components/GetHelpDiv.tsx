import React from "React";

export type HelpLink = {
  title: string;
  helpText: string;
  url: string;
};

export function GetHelpDiv() {
  const helpLinks: HelpLink[] = [
    {
      title: "Read our FAQs",
      helpText: "Checkout some of our most common questions.",
      url: "https://docs.growthbook.io/faq",
    },
    {
      title: "Checkout the Docs",
      helpText: "Checkout some of our most common questions.",
      url: "https://docs.growthbook.io/",
    },
    {
      title: "Join our Slack Channel",
      helpText: "Checkout some of our most common questions.",
      url: "https://slack.growthbook.io/?ref=docs-home",
    },
    {
      title: "Read our User Guide",
      helpText: "Checkout some of our most common questions.",
      url: "https://docs.growthbook.io/app",
    },
    {
      title: "Open a GitHub Issue",
      helpText: "Checkout some of our most common questions.",
      url: "https://github.com/growthbook/growthbook/issues",
    },
    {
      title: "Book a Meeting with GrowthBook",
      helpText: "Book some time with us to get a demo and ask questions.",
      url: "https://www.growthbook.io/demo",
    },
  ];

  return (
    <div
      className="row p-1 d-flex justify-content-space-between"
      style={{
        marginTop: "10px",
        marginBottom: "10px",
        width: "100%",
        justifyContent: "space-between",
      }}
    >
      {helpLinks.map((link) => {
        return (
          <a
            key={link.title}
            className="btn btn btn-outline-dark text-left p-3 m-1"
            href={link.url}
            target="_blank"
            rel="noreferrer"
            style={{ width: "32%" }}
          >
            <h4>{link.title}</h4>
            <p className="m-0">{link.helpText}</p>
          </a>
        );
      })}
    </div>
  );
}
