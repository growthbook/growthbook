import { Variation } from "shared/types/experiment";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { forwardRef } from "react";
import { FaArrowsAlt } from "react-icons/fa";
import { MdDeleteForever } from "react-icons/md";
import Field from "@/components/Forms/Field";

interface SortableProps {
  variation: Variation;
  variations: Variation[];
  setVariations: (variations: Variation[]) => void;
  i: number;
}

type VariationProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

const Card = forwardRef<HTMLDivElement, VariationProps>(
  ({ i, variations, variation, handle, setVariations, ...props }, ref) => {
    return (
      <div
        className=" col-lg-6 col-md-6 mb-2"
        key={i}
        style={{ minWidth: 200 }}
        ref={ref}
        {...props}
      >
        <div className="graybox">
          <div
            {...handle}
            title="Drag and drop to re-order rules"
            className="d-flex justify-content-end"
          >
            <FaArrowsAlt />
          </div>
          <Field
            label={i === 0 ? "Control Name" : `Variation ${i} Name`}
            value={variation.name}
            onChange={(e) => {
              const newVariations = [...variations];
              newVariations[i] = {
                ...variation,
                name: e.target.value,
              };
              setVariations(newVariations);
            }}
          />
          <Field
            label="Id"
            value={variation.key}
            placeholder={i + ""}
            onChange={(e) => {
              const newVariations = [...variations];
              newVariations[i] = {
                ...variation,
                key: e.target.value,
              };
              setVariations(newVariations);
            }}
          />
          <Field
            label="Description"
            value={variation.description}
            textarea
            onChange={(e) => {
              const newVariations = [...variations];
              newVariations[i] = {
                ...variation,
                description: e.target.value,
              };
              setVariations(newVariations);
            }}
          />
          <div className="text-right">
            {variations.length > 2 ? (
              <a
                className="text-danger cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  const newValues = [...variations];
                  newValues.splice(i, 1);

                  setVariations(newValues);
                }}
              >
                <MdDeleteForever /> Delete
              </a>
            ) : (
              ""
            )}
          </div>
        </div>
      </div>
    );
  },
);

Card.displayName = "Card";

export function SortableExperimentVariationCard(props) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.variation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      {...props}
      ref={setNodeRef}
      style={style}
      handle={{ ...attributes, ...listeners }}
    />
  );
}
