import { FC, useState } from "react";
import { IconType } from "react-icons";
import { GoPencil, GoBrowser, GoDatabase } from "react-icons/go";
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
  const [mode, setMode] = useState<"visual" | "import" | "scratch" | null>(
    null
  );

  const ctas: CTA[] = [
    {
      cta: "Create Visually",
      description:
        "Load your website in our Visual Editor and create variations directly on the page.",
      Icon: GoBrowser,
      onClick: () => {
        setMode("visual");
      },
    },
    {
      cta: "Create from Data Source",
      description:
        "Create an experiment by importing existing experiment data from one of your data sources.",
      Icon: GoDatabase,
      onClick: () => {
        setMode("import");
      },
    },
    {
      cta: "Create from Scratch",
      description: "Create a blank experiment and confgure it from scratch.",
      Icon: GoPencil,
      onClick: () => {
        setMode("scratch");
      },
    },
  ];

  switch (mode) {
    case "visual":
      return (
        <NewExperimentForm
          onClose={onClose}
          source={source}
          initialValue={{ implementation: "visual" }}
        />
      );
    case "import":
      return <ImportExperimentModal onClose={onClose} source={source} />;
    case "scratch":
      return <NewExperimentForm onClose={onClose} source={source} />;
    default:
      return (
        <Modal open close={() => onClose()} size="lg" header="Add Experiment">
          <h2>Chose your method of creating an Experiment</h2>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
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
