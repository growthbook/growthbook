import clsx from "clsx";
import Button from "@/components/Radix/Button";
import styles from "./ConfirmModal.module.scss";

type Props = {
  title: string;
  subtitle?: string;
  yesText?: string;
  noText?: string;
  yesColor?: string;
  modalState: boolean;
  setModalState: (state: boolean) => void;
  onConfirm: () => void;
  children?: React.ReactNode;
};

const ConfirmModal = ({
  title,
  subtitle,
  yesText = "yes",
  yesColor = "primary",
  noText = "no",
  modalState,
  setModalState,
  onConfirm,
  children,
}: Props): React.ReactElement => {
  const closeModal = () => {
    setModalState(false);
  };

  return (
    <>
      <div
        className={clsx(
          styles.modalbackground,
          "modal-backdrop fade",
          { show: modalState },
          { [styles.modalhide]: !modalState }
        )}
        onClick={closeModal}
      />
      <div
        className={clsx(
          styles.modalwrap,
          "modal fade bd-example-modal-lg",
          { [styles.modalopen]: modalState },
          { show: modalState }
        )}
        id="exampleModal"
        role="dialog"
        aria-labelledby="exampleModalLabel"
        aria-hidden="true"
      >
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content">
            <div className={`modal-body ${styles.modaltitle}`}>
              <h5 className="modal-title">{title}</h5>
              <button
                type="button"
                className="close"
                data-dismiss="modal"
                aria-label="Close"
                onClick={closeModal}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className={`modal-body ${styles.confirmbody}`}>
              {subtitle !== "" && <div>{subtitle}</div>}
              {children}
              <div>
                {noText && (
                  <Button className="no" variant="outline" onClick={closeModal}>
                    {noText}
                  </Button>
                )}
                <Button onClick={onConfirm}>{yesText}</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
export default ConfirmModal;
