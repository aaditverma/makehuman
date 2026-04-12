# Session Handoff #002 — 2026-04-12

## What Was Done

### T-Shirt Sleeve Cutoff Fix
The main bug: T-shirt heatmap showed full-length sleeves identical to Oxford shirt. Any attempt to cut sleeves shorter broke back/side torso coverage.

**Root cause found**: TWO bugs, not one:
1. **Coverage check**: `getVertexFit()` had no arm detection — `sleeveEnd` was unused for coverage
2. **Edge fade** (THE REAL KILLER): The sleeve edge fade applied to ALL vertices with `distFromCenter > 0.12`, which included the entire side torso and lower back. Below `sleeveEnd`, the fade went to 0, making those vertices invisible even though they were "covered"

**Fix applied**:
- Added `normalXAbs` parameter to `getVertexFit()` (vertex normal X component)
- BodyModel.tsx reads `geometry.attributes.normal` and passes `Math.abs(normal.getX(i))` to the heatmap engine
- Arm detection uses combined `armScore = normalXAbs + xAbs * 3 > 1.3`
- Both the coverage check AND the edge fade now use armScore to gate arm-only logic
- Side torso and back are no longer affected by sleeve cutoff

### Files Changed
- `src/utils/heatmapEngine.ts` — Added normalXAbs param, armScore-based sleeve cutoff + edge fade
- `src/components/BodyModel.tsx` — Reads vertex normals, passes to heatmap engine, removed debug logging

### Remaining Issue
- **Side torso gap**: Thin uncolored strips on the flanks where gray zone vertices (armScore 1.0–1.3) are incorrectly excluded. These are armpit/flank transition vertices. Minor visual issue, deferred.
- Possible fix: lower armScore threshold OR pre-bake arm vertex groups in Blender as a custom attribute

## Current State
- T-shirt: sleeves cut off correctly, back fully covered, minor side gaps
- Oxford shirt: unchanged, still perfect
- Jeans: unchanged, still perfect
