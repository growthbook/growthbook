import { Variation } from "shared/types/experiment";
import { generateVariationId } from "@/services/features";
import { GBAddCircle } from "@/components/Icons";
import SortableVariationsList from "@/components/Features/SortableVariationsList";
import { SortableExperimentVariationCard } from "./SortableVariationData";

export interface Props {
  variations: Variation[];
  setVariations: (variations: Variation[]) => void;
  className?: string;
}

export default function ExperimentVariationsInput({
  variations,
  setVariations,
  className = "",
}: Props) {
  return (
    <div className={className}>
      <label>Variations</label>
      <div className="row">
        <SortableVariationsList
          variations={variations}
          setVariations={setVariations}
          sortingStrategy="rect"
        >
          {variations.map((variation, i) => (
            <SortableExperimentVariationCard
              i={i}
              variation={variation}
              variations={variations}
              setVariations={setVariations}
              key={variation.id}
            />
          ))}
        </SortableVariationsList>
        <div
          className="col-lg-6 col-md-6 mb-2 text-center"
          style={{ minWidth: 200 }}
        >
          <div
            className="p-3 h-100 d-flex align-items-center justify-content-center"
            style={{
              border: "1px dashed var(--border-color-200)",
              borderRadius: "3px",
            }}
          >
            <button
              className="btn btn-outline-primary"
              onClick={(e) => {
                e.preventDefault();
                const newVariations = [...variations];
                newVariations.push({
                  name: `Variation ${variations.length}`,
                  description: "",
                  key: variations.length + "",
                  screenshots: [],
                  id: generateVariationId(),
                });
                setVariations(newVariations);
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block">
                <GBAddCircle />
              </span>{" "}
              Add Variation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
