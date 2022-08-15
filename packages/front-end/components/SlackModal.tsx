import { useState } from "react";
import Modal from "./Modal";

export default function SlackModal() {
  const [isOpen, setIsOpen] = useState(true);

  function handleClose(openSlack = false) {
    openSlack &&
      window.open(
        "https://join.slack.com/t/growthbookusers/shared_invite/zt-1eh2bjeep-sDrAhci_3sWGwsx_hsay0Q",
        "_blank"
      );
    localStorage.setItem("hasSeenSlackModal", "true");
    setIsOpen(false);
  }

  return (
    <Modal header={false} open={isOpen} className="text-center py-5 px-4">
      <img
        className="rounded-lg shadow-lg px-3"
        src="https://cdn.bfldr.com/5H442O3W/at/pl546j-7le8zk-btwjnu/Slack_RGB.png?auto=webp&format=png&width=160&height=66"
      />

      <h1 className="text-center mt-4">
        Quality answers fast on
        <br />
        GrowthBook Slack
      </h1>

      <div className="mt-4" style={{ fontSize: "1.1rem" }}>
        Join the most dedicated experimentation
        <br />
        community. Get your questions answered by
        <br />
        GrowthBook pros!
      </div>

      <div className="mt-4">
        <button
          onClick={() => {
            handleClose(true);
          }}
          className="btn btn-primary"
          style={{ width: "65%" }}
        >
          <img src="https://cdn.bfldr.com/5H442O3W/at/pl546j-7le8zk-j7mis/Slack_Mark_Monochrome_White.svg?auto=webp&format=png&width=18&height=18" />
          <span className="ml-2">Join GrowthBook Slack</span>
        </button>
      </div>
      <div className="mt-2">
        <button
          onClick={() => handleClose()}
          className="btn btn-outline-primary"
          style={{ width: "65%" }}
        >
          {`Maybe I'll join later`}
        </button>
      </div>
    </Modal>
  );
}
