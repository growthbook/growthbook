import clsx from "clsx";
import Link from "next/link";
import { FaCheck } from "react-icons/fa";
import styles from "./SuccessCard.module.scss";

type Props = {
  feature: string;
  href: string;
  onClick: () => Promise<void>;
  nextStep: string;
};

export default function SuccessCard({
  feature,
  href,
  onClick,
  nextStep,
}: Props) {
  return (
    <div className={clsx("col-12 col-lg-10 p-4", styles.wrapper)}>
      <div className="d-flex flex-column align-content-center text-center">
        <FaCheck
          className={clsx("align-self-center mb-4 p-3", styles.successBubble)}
        />
        <h1>Great job!</h1>
        <p>
          {`You successfully created a ${feature}. Want to see all of your ${feature}s
          or create more?`}
          <span>
            <Link href={href}> Click here.</Link>
          </span>
        </p>
      </div>
      <div className="d-flex flex-column justify-content-center align-content-center">
        <button
          className="btn btn-primary align-self-center m-2"
          onClick={onClick}
        >
          {nextStep}
        </button>
      </div>
    </div>
  );
}
