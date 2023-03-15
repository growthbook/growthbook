import { FC, useCallback, useState } from "react";
import qs from "query-string";
import Modal from "./Modal";

const OpenVisualEditorLink: FC<{
  visualEditorUrl?: string;
  experimentId: string;
  openSettings?: () => void;
}> = ({ experimentId, visualEditorUrl, openSettings }) => {
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [showEditorUrlDialog, setShowEditorUrlDialog] = useState(false);

  const onClick = useCallback(() => {
    if (!visualEditorUrl) {
      setShowEditorUrlDialog(true);
      return;
    }

    // check if extension is installed
    const isExtensionInstalled = !!document.getElementById(
      "__gb_visual_editor"
    );

    if (!isExtensionInstalled) {
      setShowExtensionDialog(true);
      return;
    }

    // find or create visual changeset

    const parsed = qs.parse(
      visualEditorUrl.indexOf("?") > -1 ? visualEditorUrl.split("?")[1] : ""
    );

    const queryParams = {
      ...parsed,
      "vc-id": experimentId,
    };

    const root = visualEditorUrl.split("?")[0];

    window.location.href = `${root}?${qs.stringify(queryParams)}`;
  }, [visualEditorUrl, experimentId]);

  return (
    <>
      <a className="d-none d-md-inline cursor-pointer" onClick={onClick}>
        Preview
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
