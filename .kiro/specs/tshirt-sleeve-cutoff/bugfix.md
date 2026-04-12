# Bugfix Requirements Document

## Introduction

The heatmap engine's `getVertexFit()` function cannot distinguish arm vertices from lower back vertices when applying a sleeve length cutoff for the T-shirt garment. Both regions share overlapping `distFromCenter` and `xAbs` values at the height range where T-shirt sleeves should end (~0.60 normalized height). As a result, any sleeve cutoff logic that excludes arm vertices below the sleeve end also incorrectly excludes lower back vertices, breaking back coverage. The sleeve cutoff has been removed entirely, causing the T-shirt to render with full-length sleeves identical to the Oxford shirt.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the T-shirt garment is selected THEN the system renders full-length sleeves identical to the Oxford shirt, ignoring the `sleeveEnd: 0.60` property defined in the garment data

1.2 WHEN the `sleeveEnd` property is used to exclude arm vertices below the sleeve end height THEN the system also excludes lower back vertices at the same height range, because `getVertexFit()` receives only position data (`normalizedHeight`, `xAbs`, `yPos`, `distFromCenter`) which cannot distinguish arm vertices from lower back vertices that share similar positional values

1.3 WHEN the heatmap engine computes coverage for a top garment THEN the system does not use the `sleeveEnd` property in the coverage check — it is only used in the edge fade calculation

### Expected Behavior (Correct)

2.1 WHEN the T-shirt garment is selected THEN the system SHALL render sleeves that end at the `sleeveEnd` height (0.60 normalized height, approximately mid-upper-arm / elbow level), visibly shorter than the Oxford shirt's sleeves (0.48)

2.2 WHEN the sleeve cutoff is applied to exclude arm vertices below `sleeveEnd` THEN the system SHALL correctly preserve coverage of all torso vertices (front and back), including lower back vertices at the same height range as the sleeve cutoff

2.3 WHEN the heatmap engine computes coverage for a top garment with a `sleeveEnd` property THEN the system SHALL use `sleeveEnd` as a coverage boundary for arm vertices, marking arm vertices below `sleeveEnd` as uncovered

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the Oxford shirt garment is selected THEN the system SHALL CONTINUE TO render full torso coverage (front and back) with full-length sleeves down to `sleeveEnd: 0.48`

3.2 WHEN any top garment is selected THEN the system SHALL CONTINUE TO correctly render the neckline cutout, hem edge fade, and hand exclusion zones

3.3 WHEN jeans (slim or straight) are selected THEN the system SHALL CONTINUE TO render full leg coverage from ankles to waist with correct edge fades

3.4 WHEN the Oxford shirt or T-shirt is selected THEN the system SHALL CONTINUE TO correctly cover the full back region of the torso at all height levels within the garment's coverage range

3.5 WHEN any garment is selected THEN the system SHALL CONTINUE TO compute correct fit scores (tight/balanced/loose) based on body measurements, garment size data, and fit preference
