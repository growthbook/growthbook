import { FC, useMemo, useState } from "react";
import qs from "query-string";
import { FaExternalLinkAlt } from "react-icons/fa";
import Modal from "./Modal";

const OpenVisualEditorLink: FC<{
  visualEditorUrl?: string;
  id: string;
  openSettings?: () => void;
  changeIndex: number;
}> = ({ id, visualEditorUrl, openSettings, changeIndex }) => {
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);

  const url = useMemo(() => {
    if (!visualEditorUrl) return "";

    const parsed = qs.parse(
      visualEditorUrl.indexOf("?") > -1 ? visualEditorUrl.split("?")[1] : ""
    );

    const queryParams = {
      ...parsed,
      "vc-id": id,
      "v-idx": changeIndex,
      "exp-url": encodeURIComponent(window.location.href),
    };

    const root = visualEditorUrl.split("?")[0];

    return `${root}?${qs.stringify(queryParams)}`;
  }, [visualEditorUrl, id, changeIndex]);

  return (
    <>
      <a
        className="btn btn-sm btn-primary"
        href={url || "#"}
        onClick={(e) => {
          if (!visualEditorUrl) {
            e.preventDefault();
            setShowEditorUrlDialog(true);
            return;
          }

          // check if extension is installed
          const isExtensionInstalled = !!document.getElementById(
            "__gb_visual_editor"
          );

          if (!isExtensionInstalled) {
            e.preventDefault();
            setShowExtensionDialog(true);
            return;
          }
        }}
      >
        Open Editor <FaExternalLinkAlt />
      </a>

      {showEditorUrlDialog && openSettings && (
        <Modal
          open
          header="Visual Editor Target URL"
          close={() => setShowEditorUrlDialog(false)}
          closeCta="Close"
          cta="Open settings"
          submit={openSettings}
        >
          You&apos;ll need to define the{" "}
          <strong>Visual Editor Target URL</strong> in your experiment&apos;s
          settings first. This will configure which web page will be opened when
          you click on the &quot;Open the Editor&quot; button.
        </Modal>
      )}

      {showExtensionDialog && (
        <Modal
          open
          header="GrowthBook DevTools Extension"
          close={() => setShowExtensionDialog(false)}
          closeCta="Close"
          cta="View extension"
          submit={() => {
            window.open(
              // TODO - parameterize this
              "https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia"
            );
          }}
        >
          You&apos;ll need to install the GrowthBook DevTools Chrome extension
          to use the visual editor.{" "}
        </Modal>
      )}
    </>
  );
};

export default OpenVisualEditorLink;
