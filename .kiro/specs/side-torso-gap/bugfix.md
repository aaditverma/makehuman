# Bugfix Requirements Document

## Introduction

The heatmap engine's sleeve cutoff logic in `getVertexFit()` uses `armScore > 1.3` to classify arm vertices, which correctly identifies actual arm vertices (score ~1.2–2.0) and correctly preserves deep torso vertices (score ~0.7–1.1). However, vertices in the gray zone (armScore 1.0–1.3) at the armpit/flank boundary — which are anatomically side torso, not arm — are not receiving heatmap coverage when the T-shirt garment is selected. This creates a visible gap along the side of the torso in the heatmap visualization.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the T-shirt garment is selected with heatmap enabled AND a vertex lies at the armpit/flank boundary with armScore between 1.0 and 1.3 (normalXAbs ~0.4–0.6, xAbs ~0.10–0.15) THEN the system does not render heatmap coverage for that vertex, leaving a visible gray gap on the side of the torso

1.2 WHEN the heatmap engine evaluates side torso vertices in the armScore gray zone (1.0–1.3) that are below the sleeveEnd height (0.60) THEN the system fails to classify these vertices as torso, resulting in missing heatmap color at the armpit/flank transition area

1.3 WHEN the armScore formula (`normalXAbs + xAbs * 3`) produces a value between 1.0 and 1.3 for a vertex THEN the system has no mechanism to disambiguate whether the vertex is side torso (should be covered) or arm (should be uncovered below sleeveEnd), causing the gap

### Expected Behavior (Correct)

2.1 WHEN the T-shirt garment is selected with heatmap enabled AND a vertex lies at the armpit/flank boundary with armScore between 1.0 and 1.3 THEN the system SHALL render heatmap coverage for that vertex, treating it as side torso rather than arm

2.2 WHEN the heatmap engine evaluates vertices in the armScore gray zone (1.0–1.3) below the sleeveEnd height THEN the system SHALL use an additional signal (such as the vertex normal Y component or a refined threshold) to correctly classify these vertices as side torso and include them in heatmap coverage

2.3 WHEN the armScore-based arm detection is applied for sleeve cutoff THEN the system SHALL ensure no visible gap exists between the covered torso region and the uncovered arm region at the armpit/flank boundary

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a vertex has armScore clearly above the arm threshold (score > ~1.3–1.5, actual arm vertices with normalXAbs ~0.7–1.0, xAbs ~0.15–0.35) AND is below sleeveEnd THEN the system SHALL CONTINUE TO exclude that vertex from T-shirt heatmap coverage (sleeve cutoff)

3.2 WHEN a vertex has armScore clearly below the gray zone (score < 1.0, deep torso vertices with normalXAbs < 0.4) THEN the system SHALL CONTINUE TO include that vertex in heatmap coverage with correct fit scores

3.3 WHEN the Oxford shirt garment is selected THEN the system SHALL CONTINUE TO render full torso and long-sleeve coverage down to sleeveEnd 0.48 without any gaps

3.4 WHEN jeans (slim or straight) are selected THEN the system SHALL CONTINUE TO render full leg coverage from ankles to waist, completely unaffected by arm detection logic

3.5 WHEN any top garment is selected THEN the system SHALL CONTINUE TO correctly render neckline cutouts, hem edge fades, hand exclusion zones, and fit score calculations

3.6 WHEN the sleeve edge fade is applied near sleeveEnd for actual arm vertices THEN the system SHALL CONTINUE TO produce a smooth visual transition at the sleeve boundary
