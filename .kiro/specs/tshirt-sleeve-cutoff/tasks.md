# Tasks — T-Shirt Sleeve Cutoff Bugfix

- [x] 1. Add `normalXAbs` parameter to heatmap engine
  - [x] 1.1 Update `HeatmapResult` interface: add `normalXAbs: number` as 5th parameter to `getVertexFit()` signature
  - [x] 1.2 Add arm detection + sleeve cutoff coverage check in `getVertexFit()`: if garment is top AND has `sleeveEnd` AND `normalXAbs > 0.5` AND `h < sleeveEnd`, return `covered: false`
- [x] 2. Pass vertex normals from BodyModel to heatmap engine
  - [x] 2.1 In the heatmap `useEffect` in `BodyModel.tsx`, read `geometry.attributes.normal` and compute `normalXAbs = Math.abs(normal.getX(i))` for each vertex
  - [x] 2.2 Pass `normalXAbs` as the 5th argument to `heatmap.getVertexFit()` call
- [x] 3. Verify fix and preservation
  - [x] 3.1 Visually verify T-shirt renders with short sleeves ending at ~0.60 height while back remains fully covered
  - [x] 3.2 Visually verify Oxford shirt is unchanged (full sleeves, full torso coverage)
  - [x] 3.3 Visually verify jeans are unchanged
