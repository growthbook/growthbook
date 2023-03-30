import { FC, useState } from "react";
import { IconType } from "react-icons";
import { GoBeaker, GoGraph } from "react-icons/go";
import track from "@/services/track";
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
          <Icon size={96} />
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
      cta: "Analyze an Existing Experiment",
      description:
        "Analyze a current or past experiment that already has data collected",
      Icon: GoGraph,
      onClick: () => {
        setMode("import");
        track("Analyze an Existing Experiment", { source });
      },
    },
    {
      cta: "Design a New Experiment",
      description:
        "Use Feature Flags or our Visual Editor to build and run a brand new experiment",
      Icon: GoBeaker,
      onClick: () => {
        setMode("new");
        track("Design a New Experiment", { source });
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
