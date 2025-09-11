import React, { useState } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";

interface EntityAccordionProps {
  entity: any;
  entityId: string;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  children?: React.ReactNode;
}

export const EntityAccordion: React.FC<EntityAccordionProps> = ({
  entity,
  entityId,
  isExpanded,
  onToggle,
  children,
}) => {
  const toggleExpanded = () => {
    onToggle(entityId);
  };

  return (
    <td>
      <button
        type="button"
        onClick={toggleExpanded}
        className="btn btn-link px-2 py-0"
      >
        {isExpanded ? <FaChevronDown size={18}/> : <FaChevronRight size={18}/>}
      </button>
    </td>
  );
};

interface EntityAccordionContentProps {
  entity: any;
  isExpanded: boolean;
}

export const EntityAccordionContent: React.FC<EntityAccordionContentProps> = ({
  entity,
  isExpanded,
}) => {
  if (!isExpanded) return null;

  return (
    <tr>
      <td 
        colSpan={100} 
        className="p-0"
        style={{ 
          padding: 0,
          border: "none"
        }}
      >
        <div
          className="bg-light"
          style={{
            maxHeight: "300px",
            overflowY: "auto",
            borderTop: "1px solid #dee2e6",
            width: "100%",
            padding: "12px",
            margin: 0,
            boxSizing: "border-box"
          }}
        >
          <code style={{ 
            fontSize: "12px", 
            whiteSpace: "pre-wrap", 
            display: "block",
            width: "100%",
            wordBreak: "break-all"
          }}>
            {JSON.stringify(entity, null, 2)}
          </code>
        </div>
      </td>
    </tr>
  );
};
