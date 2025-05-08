import React, { FC, useMemo, useState } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
// Only basic SVG elements needed now
import { useTooltipInPortal } from "@visx/tooltip"; // Re-added for containerBounds

export interface Segment {
  label: string; 
  value: number;
  color: string;
}

export interface VennDiagramProps {
  data: Segment[]; // Expects 3 segments, ideally identifiable by label
  formatter: (value: number) => string;
  height?: number;
  margin?: [number, number, number, number];
  baseOpacity?: number; // Opacity for the base circles
  hoverOpacityIncrease?: number; // How much to increase opacity on hover
  labelFontSize?: number;
  labelColor?: string;
  // Removed props irrelevant to this new approach
}

// Helper to calculate intersection points and area (simplified for positioning)
// A full geometric solution is complex. This provides basic positioning info.
function calculateVennLayout(rA: number, rB: number, d: number) {
    // Ensure distance is valid
    d = Math.max(Math.abs(rA - rB), Math.min(d, rA + rB));

    const dSq = d * d;
    const rASq = rA * rA;
    const rBSq = rB * rB;

    // Check for containment or separation
    if (d >= rA + rB) return { xIntersect: null, yIntersect: null, area: 0 }; // Separated
    if (d <= Math.abs(rA - rB)) return { xIntersect: null, yIntersect: null, area: Math.PI * Math.min(rASq, rBSq) }; // Contained

    const angleA = Math.acos((dSq + rASq - rBSq) / (2 * d * rA));
    const angleB = Math.acos((dSq + rBSq - rASq) / (2 * d * rB));

    // Intersection area (for reference, not directly used for drawing shape here)
    const area = angleA * rASq + angleB * rBSq - 0.5 * Math.sqrt((-d + rA + rB) * (d + rA - rB) * (d - rA + rB) * (d + rA + rB));

    // Midpoint of the line connecting circle centers
    const x = (rASq - rBSq + dSq) / (2 * d);
    const y = Math.sqrt(Math.max(0, rASq - x * x)); // Height of intersection points from center line

    // Return intersection points relative to center A (assuming A is at 0,0 and B is at d,0)
    return {
        xIntersect: x, 
        yIntersect: y, 
        area: area
    };
}

const VennDiagram: FC<VennDiagramProps> = ({
  data, 
  formatter,
  height = 250, 
  margin = [20, 20, 20, 20],
  baseOpacity = 0.4, // Base opacity for circles
  hoverOpacityIncrease = 0.3, // Increase opacity on hover
  labelFontSize = 11,
  labelColor = "#333",
}: VennDiagramProps) => {
  
  // Re-add useTooltipInPortal to get containerBounds for coordinate calculations
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null); // "A", "B", or "AB"

  // Robustly identify segments, falling back to array order
  const intersectionSegment = data.find(s => s.label.toLowerCase().includes("both")) || data[0];
  const groupAOnlySegment = data.find(s => s.label.toLowerCase().includes("only") && !s.label.toLowerCase().includes(data[2]?.label.split(" ")[0])) || data[1];
  const groupBOnlySegment = data.find(s => s.label.toLowerCase().includes("only") && !s.label.toLowerCase().includes(data[1]?.label.split(" ")[0])) || data[2];

  return (
    <ParentSizeModern style={{ position: "relative" }} debounceTime={10}>
      {({ width: parentWidth }) => {
        if (parentWidth <= 0 || height <= 0) return null;
        if (!intersectionSegment || !groupAOnlySegment || !groupBOnlySegment) {
            return <div style={{textAlign: 'center', padding: '20px'}}>Insufficient data for Venn diagram</div>;
        }

        const [marginTop, marginRight, marginBottom, marginLeft] = margin;
        const svgWidth = parentWidth;
        const svgHeight = height;
        const usableWidth = Math.max(0, svgWidth - marginLeft - marginRight);
        const usableHeight = Math.max(0, svgHeight - marginTop - marginBottom);
        if (usableWidth <= 0 || usableHeight <= 0) return null;

        const valueAB = intersectionSegment.value;
        const valueAOnly = groupAOnlySegment.value;
        const valueBOnly = groupBOnlySegment.value;
        const sizeA = valueAOnly + valueAB;
        const sizeB = valueBOnly + valueAB;
        const totalSize = valueAOnly + valueBOnly + valueAB;

        if (totalSize === 0) {
           return <div style={{textAlign: 'center', padding: '20px'}}>No data to display</div>;
        }

        // --- Sizing and Positioning Calculations --- 
        const maxDimension = Math.min(usableWidth, usableHeight);
        const maxRadiusPossible = maxDimension / 4.0;
        
        // Radii proportional to sqrt of area
        const rA = sizeA > 0 ? Math.sqrt(sizeA / totalSize) * maxRadiusPossible : 0;
        const rB = sizeB > 0 ? Math.sqrt(sizeB / totalSize) * maxRadiusPossible : 0;
        
        // Heuristic for distance based on intersection size
        // Ensure radii are positive before calculating distance
        let d = 0;
        if (rA > 0 && rB > 0) {
             // Intersection strength factor (0=no overlap, 1=high overlap)
            const intersectionFactor = valueAB / (valueAOnly + valueBOnly + valueAB + 1e-6); // Add epsilon to avoid div by zero
            // Distance heuristic: closer if intersectionFactor is high
            // Range from (rA+rB)*0.1 (close) to (rA+rB)*0.9 (far apart)
            const targetDistanceRatio = 0.9 - 0.8 * Math.sqrt(intersectionFactor); 
            d = (rA + rB) * Math.max(0.1, Math.min(0.9, targetDistanceRatio));
            // Clamp distance: must be >= |rA - rB| and <= rA + rB
            d = Math.max(Math.abs(rA - rB) + 1, Math.min(d, rA + rB - 1)); // Add/subtract 1 for visibility
        }
         else if (rA > 0) d = rA * 2 + 10; // Place B far away if no size
         else if (rB > 0) d = rB * 2 + 10; // Place A far away

        // Center the diagram
        const diagramCenterX = usableWidth / 2;
        const diagramCenterY = usableHeight / 2;
        
        // Position circle centers along the horizontal axis
        const totalSpan = d > 0 ? (d / 2 + Math.max(rA, rB)) * 2 : (rA + rB) * 1.1;
        const scaleFactor = usableWidth / Math.max(totalSpan, usableWidth * 0.5);
        const scaled_rA = rA * scaleFactor;
        const scaled_rB = rB * scaleFactor;
        const scaled_d = d * scaleFactor;

        const cxA = diagramCenterX - scaled_d / 2;
        const cyA = diagramCenterY;
        const cxB = diagramCenterX + scaled_d / 2;
        const cyB = diagramCenterY;

        // Calculate intersection geometry for text placement
        const layout = calculateVennLayout(scaled_rA, scaled_rB, scaled_d);
        
        // Text positioning needs refinement based on actual geometry
        // Move A and B text outside the circles
        const textPosA = { x: cxA - scaled_rA * 1.1, y: cyA }; // Factor > 1 moves it leftwards, outside circle A
        const textPosB = { x: cxB + scaled_rB * 1.1, y: cyB }; // Factor > 1 moves it rightwards, outside circle B
        const textPosAB = { 
            x: cxA + (layout.xIntersect !== null ? layout.xIntersect : scaled_d/2), 
            y: cyA 
        };

        // Function to determine if label should be dark or light based on background color
        const getContrastColor = (hexcolor: string): string => {
          if (!hexcolor) return labelColor;
          hexcolor = hexcolor.replace("#", "");
          // Basic check for hex length
          if (hexcolor.length !== 6 && hexcolor.length !== 3) return labelColor; 
          if (hexcolor.length === 3) {
              hexcolor = hexcolor.split('').map(c => c+c).join('');
          }
          try {
            const r = parseInt(hexcolor.substr(0, 2), 16);
            const g = parseInt(hexcolor.substr(2, 2), 16);
            const b = parseInt(hexcolor.substr(4, 2), 16);
            const yiq = (r * 299 + g * 587 + b * 114) / 1000;
            return yiq >= 128 ? '#000000' : '#FFFFFF';
          } catch(e) {
              return labelColor; // Fallback on error
          }
        };

        const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
            const { x, y } = event.nativeEvent;
            // Need containerBounds here
            if (!containerBounds) return; 
            
            const svgX = x - containerBounds.left - marginLeft;
            const svgY = y - containerBounds.top - marginTop;

            const distToA = Math.sqrt(Math.pow(svgX - cxA, 2) + Math.pow(svgY - cyA, 2));
            const distToB = Math.sqrt(Math.pow(svgX - cxB, 2) + Math.pow(svgY - cyB, 2));

            const inA = distToA < scaled_rA;
            const inB = distToB < scaled_rB;

            if (inA && inB) setHoveredRegion("AB");
            else if (inA) setHoveredRegion("A"); // Represents A-only region for hover state
            else if (inB) setHoveredRegion("B"); // Represents B-only region for hover state
            else setHoveredRegion(null);
        };

        const handlePointerLeave = () => setHoveredRegion(null);

        return (
          <>
            {/* Interaction layer (covers drawing area) */}
            <div
              ref={containerRef}
              style={{
                zIndex: 10,
                position: 'absolute',
                left: marginLeft,
                top: marginTop,
                width: usableWidth,
                height: usableHeight,
                pointerEvents: 'all',
              }}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            />
            {/* SVG Layer (below interaction layer) */}
            <svg width={svgWidth} height={svgHeight} style={{ pointerEvents: 'none' }}>
              <Group top={marginTop} left={marginLeft} style={{ mixBlendMode: 'multiply' }}>
                 {/* Circle A - uses A-only color but covers intersection */}
                <circle
                  cx={cxA}
                  cy={cyA}
                  r={scaled_rA}
                  fill={groupAOnlySegment.color}
                  opacity={hoveredRegion === 'A' || hoveredRegion === 'AB' ? baseOpacity + hoverOpacityIncrease : baseOpacity}
                />
                 {/* Circle B - uses B-only color but covers intersection */}
                <circle
                  cx={cxB}
                  cy={cyB}
                  r={scaled_rB}
                  fill={groupBOnlySegment.color}
                  opacity={hoveredRegion === 'B' || hoveredRegion === 'AB' ? baseOpacity + hoverOpacityIncrease : baseOpacity}
                />
              </Group>
               {/* Outlines (drawn outside the blended group) */}
               <Group top={marginTop} left={marginLeft}>
                    <circle cx={cxA} cy={cyA} r={scaled_rA} fill="none" stroke="#aaa" strokeWidth="1" opacity={0.5} />
                    <circle cx={cxB} cy={cyB} r={scaled_rB} fill="none" stroke="#aaa" strokeWidth="1" opacity={0.5} />
               </Group>
               {/* Text Layer (drawn on top) */}
               <Group top={marginTop} left={marginLeft}>
                  {/* Text for Group A Only using foreignObject */}
                <foreignObject
                  x={textPosA.x - scaled_rA * 0.4} // Adjust x based on estimated width
                  y={textPosA.y - scaled_rA * 0.4} // Adjust y based on estimated height
                  width={scaled_rA * 0.8} // Estimated width
                  height={scaled_rA * 0.8} // Estimated height
                  style={{ pointerEvents: 'none' }} // Allow hover on underlying elements
                >
                   <div 
                      style={{
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          width: '100%',
                          height: '100%',
                          textAlign: 'center',
                          maxWidth: '70px',
                          fontSize: labelFontSize,
                          color: labelColor, // Using default labelColor
                          wordWrap: 'break-word',
                          fontWeight: hoveredRegion === 'A' ? 'bold' : 'normal',
                      }}
                   >
                      <div>{groupAOnlySegment.label}</div>
                      <div>{formatter(valueAOnly)}</div>
                  </div>
                </foreignObject>

                {/* Text for Group B Only using foreignObject */}
                <foreignObject 
                  x={textPosB.x - scaled_rB * 0.4} // Adjust x based on estimated width
                  y={textPosB.y - scaled_rB * 0.4} // Adjust y based on estimated height
                  width={scaled_rB * 0.8} // Estimated width
                  height={scaled_rB * 0.8} // Estimated height
                  style={{ pointerEvents: 'none' }} // Allow hover on underlying elements
                >
                   <div 
                      style={{
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          width: '100%',
                          height: '100%',
                          textAlign: 'center',
                          maxWidth: '70px',
                          fontSize: labelFontSize,
                          color: labelColor, // Using default labelColor, contrast logic could be reapplied here if needed
                          wordWrap: 'break-word',
                          fontWeight: hoveredRegion === 'B' ? 'bold' : 'normal',
                      }}
                   >
                      <div>{groupBOnlySegment.label}</div>
                      <div>{formatter(valueBOnly)}</div>
                  </div>
                </foreignObject>

                {/* Text for Intersection AB using foreignObject */}
                {valueAB > 0 && (
                    <foreignObject
                        x={textPosAB.x - scaled_rA * 0.3} // Smaller width/height for intersection
                        y={textPosAB.y - Math.min(scaled_rA, scaled_rB) * 0.3}
                        width={scaled_rA * 0.6} // Smaller width/height for intersection
                        height={Math.min(scaled_rA, scaled_rB) * 0.6}
                        style={{ pointerEvents: 'none' }} 
                     >
                        <div 
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                alignItems: 'center',
                                width: '100%',
                                height: '100%',
                                textAlign: 'center',
                                fontSize: labelFontSize,
                                color: labelColor, // Using default labelColor
                                wordWrap: 'break-word',
                                fontWeight: hoveredRegion === 'AB' ? 'bold' : 'normal',
                            }}
                        >
                            <div>{intersectionSegment.label}</div>
                            <div>{formatter(valueAB)}</div>
                        </div>
                     </foreignObject>
                )}
               </Group>
            </svg>
          </>
        );
      }}
    </ParentSizeModern>
  );
};

export default VennDiagram; 