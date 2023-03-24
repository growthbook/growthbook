import { FC, useState } from "react";
import { IconType } from "react-icons";
import { GoBrowser, GoDatabase } from "react-icons/go";
import Modal from "../Modal";
import styles from "./AddExperimentModal.module.scss";
import ImportExperimentModal from "./ImportExperimentModal";
import NewExperimentForm from "./NewExperimentForm";

type CTA = {
  Icon: IconType;
  onClick: () => void;
  cta: string;
  description: string;
};

const CreateExperimentCTA: FC<CTA> = ({ Icon, onClick, cta, description }) => {
  return (
    <div className={styles.ctaContainer} onClick={onClick}>
      <div className={styles.ctaButton}>
        <div className={styles.ctaIconContainer}>
          <Icon size={128} />
        </div>
        <div>
          <h3 className={styles.ctaText}>{cta}</h3>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
};

const AddExperimentModal: FC<{
  onClose: () => void;
  source?: string;
}> = ({ onClose, source }) => {
  const [mode, setMode] = useState<"new" | "import" | null>(null);

  const ctas: CTA[] = [
    {
      cta: "Import from Data Source",
      description:
        "Analyze results of an existing experiment that was run outside of GrowthBook",
      Icon: GoDatabase,
      onClick: () => {
        setMode("import");
      },
    },
    {
      cta: "Create a New Experiment",
      description:
        "Use Feature Flags or our Visual Editor to build and run a brand new experiment",
      Icon: GoBrowser,
      onClick: () => {
        setMode("new");
      },
    },
  ];

  switch (mode) {
    case "new":
      return (
        <NewExperimentForm
          onClose={onClose}
          source={source}
          isNewExperiment={true}
        />
      );
    case "import":
      return <ImportExperimentModal onClose={onClose} source={source} />;
    default:
      return (
        <Modal open close={() => onClose()} size="lg" header="Add Experiment">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            {ctas.map(({ cta, description, Icon, onClick }, index) => (
              <CreateExperimentCTA
                key={index}
                cta={cta}
                Icon={Icon}
                onClick={onClick}
                description={description}
              />
            ))}
          </div>
        </Modal>
      );
  }
};

export default AddExperimentModal;
