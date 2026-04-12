# Side Torso Gap Bugfix Design

## Overview

The heatmap engine's arm detection uses `armScore = normalXAbs + xAbs * 3` with a hard cutoff at 1.3 to classify arm vs torso vertices. This works well for clear-cut cases (deep torso score ~0.7–1.1, actual arms score ~1.2–2.0), but vertices in the gray zone (armScore 1.0–1.3) at the armpit/flank boundary are anatomically side torso yet receive no heatmap coverage when T-shirt is selected. The fix adds the vertex normal Y component (`normalYAbs`) as a secondary disambiguation signal — armpit/flank vertices have higher `|normalY|` (surface curves upward into the armpit concavity) while actual arm vertices have low `|normalY|` (cylindrical surface facing outward). This allows the gray zone to be resolved without changing the threshold for clear arm or clear torso vertices.

## Glossary

- **Bug_Condition (C)**: A vertex has armScore in [1.0, 1.3] (gray zone), is anatomically side torso, but gets excluded from T-shirt heatmap coverage because the engine cannot disambiguate it from an arm vertex
- **Property (P)**: Gray zone vertices that are side torso (high `|normalY|`) should be covered; gray zone vertices that are actual arm (low `|normalY|`) should remain uncovered below sleeveEnd
- **Preservation**: All existing behavior for vertices outside the gray zone — actual arm exclusion (armScore > 1.3), deep torso coverage (armScore < 1.0), Oxford shirt, jeans, necklines, hem fades, hand exclusion, fit scores — must remain unchanged
- **`armScore`**: Combined signal `normalXAbs + xAbs * 3` used to classify arm vs torso vertices. Higher = more arm-like
- **`normalYAbs`**: Absolute value of the vertex normal's Y component. Armpit/flank concavity vertices have higher `|normalY|` (~0.3–0.7) because the surface curves upward; arm cylinder vertices have low `|normalY|` (~0.0–0.2)
- **Gray zone**: armScore range [1.0, 1.3] where side torso and arm vertices overlap in the current single-signal classification
- **`getVertexFit()`**: Function in `src/utils/heatmapEngine.ts` that determines vertex coverage, fit score, and edge fade for a garment
- **`sleeveEnd`**: Normalized height where sleeves end (0.60 for tee, 0.48 for oxford)

## Bug Details

### Bug Condition

The bug manifests when the T-shirt garment is selected and a vertex at the armpit/flank boundary has an armScore between 1.0 and 1.3. These vertices are anatomically side torso (normalXAbs ~0.4–0.6, xAbs ~0.10–0.15), but the current hard cutoff at 1.3 provides no mechanism to distinguish them from actual arm vertices that also fall in this range. The result is a visible gray gap along the side of the torso.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { h: number, xAbs: number, normalXAbs: number, normalYAbs: number, garment: GarmentSizeChart }
  OUTPUT: boolean

  LET armScore = input.normalXAbs + input.xAbs * 3
  LET sleeveEnd = input.garment.sleeveEnd

  RETURN sleeveEnd IS DEFINED
         AND input.h < sleeveEnd
         AND armScore >= 1.0
         AND armScore <= 1.3
         AND input.normalYAbs > 0.25
         AND getVertexFit_current(input) reports covered = false
END FUNCTION
```

Note: `normalYAbs > 0.25` identifies the side-torso subset of the gray zone. Actual arm vertices in the gray zone have `normalYAbs < 0.15` and should correctly remain uncovered.

### Examples

- **Side torso at armpit (h=0.58, normalXAbs=0.5, xAbs=0.12, normalYAbs=0.45)**: armScore = 0.5 + 0.12*3 = 0.86. Actually below gray zone — already covered. No bug here.
- **Side torso at flank (h=0.55, normalXAbs=0.6, xAbs=0.15, normalYAbs=0.35)**: armScore = 0.6 + 0.15*3 = 1.05. In gray zone. High normalYAbs indicates armpit concavity → should be covered, but currently excluded. **Bug.**
- **Side torso upper flank (h=0.58, normalXAbs=0.7, xAbs=0.13, normalYAbs=0.40)**: armScore = 0.7 + 0.13*3 = 1.09. In gray zone. High normalYAbs → should be covered. **Bug.**
- **Arm vertex in gray zone (h=0.57, normalXAbs=0.8, xAbs=0.14, normalYAbs=0.08)**: armScore = 0.8 + 0.14*3 = 1.22. In gray zone. Low normalYAbs indicates arm cylinder → should remain uncovered. **Correct behavior.**
- **Clear arm vertex (h=0.55, normalXAbs=0.9, xAbs=0.25, normalYAbs=0.05)**: armScore = 0.9 + 0.25*3 = 1.65. Above gray zone → excluded by existing threshold. **Correct behavior.**
- **Deep torso vertex (h=0.55, normalXAbs=0.3, xAbs=0.08, normalYAbs=0.1)**: armScore = 0.3 + 0.08*3 = 0.54. Below gray zone → covered by existing logic. **Correct behavior.**

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Actual arm vertices (armScore > 1.3) below sleeveEnd must continue to be excluded from T-shirt coverage
- Deep torso vertices (armScore < 1.0) must continue to receive full heatmap coverage with correct fit scores
- Oxford shirt coverage: full torso front+back, long sleeves to sleeveEnd=0.48, no gaps
- Jeans coverage: full legs from ankles to waist, completely unaffected by arm detection
- Neckline cutout logic for all top garments (round, vneck, collar)
- Hand exclusion zones (distFromCenter > 0.22 && h < 0.52)
- Hem edge fade at garment bottom boundary
- Sleeve edge fade near sleeveEnd for actual arm vertices (armScore > 1.3)
- Fit score calculation (tight/balanced/loose) for all garments and all regions

**Scope:**
All inputs where armScore is NOT in the gray zone [1.0, 1.3] should be completely unaffected by this fix. This includes:
- All deep torso vertices (armScore < 1.0)
- All clear arm vertices (armScore > 1.3)
- All bottom garment vertices (jeans)
- All vertices above sleeveEnd height
- All non-heatmap rendering paths

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Single-signal classification with hard cutoff**: The `armScore > 1.3` threshold is a single boundary that must separate two overlapping populations. Side torso vertices at the armpit/flank have normalXAbs ~0.4–0.6 and xAbs ~0.10–0.15 (score ~0.7–1.1), while actual arm vertices have normalXAbs ~0.7–1.0 and xAbs ~0.15–0.35 (score ~1.2–2.0). The overlap region (score 1.0–1.3) contains both populations, and a single threshold cannot separate them.

2. **Missing secondary signal**: The vertex normal Y component (`normalY`) provides a strong disambiguation signal in the gray zone. Armpit/flank vertices sit in a concave region where the surface curves upward, giving them higher `|normalY|` (~0.3–0.7). Arm cylinder vertices face outward with low `|normalY|` (~0.0–0.2). This signal is available from the mesh normals already read in `BodyModel.tsx` but is not passed to or used by `getVertexFit()`.

3. **No soft transition in gray zone**: Even with a secondary signal, a hard cutoff at any single threshold creates a sharp boundary. A soft blend/transition in the gray zone would produce smoother visual results at the armpit/flank boundary.

## Correctness Properties

Property 1: Bug Condition - Gray Zone Side Torso Vertices Get Coverage

_For any_ vertex where armScore is in [1.0, 1.3] (gray zone) AND normalYAbs > 0.25 (indicating armpit/flank concavity rather than arm cylinder) AND the vertex height is below sleeveEnd, the fixed `getVertexFit()` SHALL return `covered: true`, correctly including the side torso vertex in T-shirt heatmap coverage.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Gray-Zone Vertices Unchanged

_For any_ vertex where armScore is NOT in the gray zone [1.0, 1.3] (i.e., armScore < 1.0 or armScore > 1.3), the fixed `getVertexFit()` SHALL produce exactly the same `covered`, `fitScore`, and `edgeFade` values as the original function, preserving all existing arm exclusion and torso coverage behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/utils/heatmapEngine.ts`

**Function**: `getVertexFit()`

**Specific Changes**:

1. **Add `normalYAbs` parameter**: Extend the `getVertexFit()` signature and `HeatmapResult` interface to accept the absolute Y component of the vertex normal as a sixth parameter (default 0 for backward compatibility).

2. **Refine gray zone classification**: In the sleeve cutoff section, instead of the single `armScore > 1.3` check, add a secondary check for the gray zone:
   - If `armScore > 1.3`: uncovered (unchanged — clear arm)
   - If `armScore >= 1.0 && armScore <= 1.3`: use `normalYAbs` to disambiguate
     - If `normalYAbs > 0.25`: treat as side torso → covered (fix)
     - If `normalYAbs <= 0.25`: treat as arm → uncovered
   - If `armScore < 1.0`: covered (unchanged — clear torso)

3. **Update edge fade for gray zone**: The edge fade section also uses `armScore > 1.3` to gate sleeve fade. Update this to also apply sleeve fade to gray zone vertices classified as arm (armScore in [1.0, 1.3] AND normalYAbs <= 0.25), so the visual transition remains smooth.

4. **Add soft transition at gray zone boundary** (optional enhancement): For gray zone vertices near the normalYAbs threshold (0.25), apply a small edge fade blend to soften the transition between covered and uncovered regions.

**File**: `src/components/BodyModel.tsx`

5. **Extract normalYAbs in heatmap effect**: In the heatmap `useEffect`, alongside the existing `normalXAbs` extraction, also compute `normalYAbs = Math.abs(nor.getY(i))` from the geometry's normal attribute.

6. **Pass `normalYAbs` to `getVertexFit()`**: Update the call to `heatmap.getVertexFit()` to include `normalYAbs` as the sixth argument.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that gray zone side-torso vertices are incorrectly excluded from T-shirt coverage.

**Test Plan**: Create test inputs with vertex positions and normals that produce armScore values in the gray zone [1.0, 1.3] with high normalYAbs (side torso characteristics). Run `computeHeatmap()` + `getVertexFit()` on the UNFIXED code to observe that these vertices return `covered: false`.

**Test Cases**:
1. **Flank vertex (armScore=1.05, normalYAbs=0.35)**: normalXAbs=0.6, xAbs=0.15, h=0.55. Should be covered but unfixed code returns covered=false (will fail on unfixed code)
2. **Upper flank vertex (armScore=1.09, normalYAbs=0.40)**: normalXAbs=0.7, xAbs=0.13, h=0.58. Should be covered but unfixed code returns covered=false (will fail on unfixed code)
3. **Armpit vertex (armScore=1.20, normalYAbs=0.50)**: normalXAbs=0.75, xAbs=0.15, h=0.57. Should be covered but unfixed code returns covered=false (will fail on unfixed code)
4. **Gray zone arm vertex (armScore=1.22, normalYAbs=0.08)**: normalXAbs=0.8, xAbs=0.14, h=0.57. Should remain uncovered — this is a true arm vertex in the gray zone (may pass on unfixed code since armScore < 1.3)

**Expected Counterexamples**:
- Side torso vertices with armScore in [1.0, 1.3] and high normalYAbs return `covered: false`
- The unfixed code has no way to distinguish these from arm vertices because normalYAbs is not used

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := getVertexFit_fixed(input.h, input.xAbs, input.yPos, input.distFromCenter, input.normalXAbs, input.normalYAbs)
  ASSERT result.covered = true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT getVertexFit_original(input.h, input.xAbs, input.yPos, input.distFromCenter, input.normalXAbs)
       = getVertexFit_fixed(input.h, input.xAbs, input.yPos, input.distFromCenter, input.normalXAbs, input.normalYAbs)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random vertex positions and normals across the full input domain
- It catches edge cases at the gray zone boundaries that manual tests might miss
- It provides strong guarantees that behavior is unchanged for all non-gray-zone vertices
- fast-check is already installed as a dev dependency

**Test Plan**: Observe behavior on UNFIXED code first for vertices outside the gray zone, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Deep torso preservation (armScore < 1.0)**: Verify all deep torso vertices continue to receive full heatmap coverage with correct fit scores after fix
2. **Clear arm preservation (armScore > 1.3)**: Verify all clear arm vertices below sleeveEnd continue to be excluded after fix
3. **Oxford shirt preservation**: Verify oxford shirt coverage is identical before and after fix (sleeveEnd=0.48, long sleeves)
4. **Jeans preservation**: Verify all jeans coverage is completely unchanged (bottom garment, no arm detection)
5. **Edge fade preservation**: Verify sleeve edge fade for clear arm vertices (armScore > 1.3) near sleeveEnd produces same edgeFade values

### Unit Tests

- Test `getVertexFit()` with gray zone side-torso vertex (armScore 1.05, normalYAbs 0.35) → covered=true
- Test `getVertexFit()` with gray zone arm vertex (armScore 1.22, normalYAbs 0.08) → covered=false
- Test `getVertexFit()` with clear arm vertex (armScore 1.5) → covered=false (unchanged)
- Test `getVertexFit()` with deep torso vertex (armScore 0.5) → covered=true (unchanged)
- Test `getVertexFit()` with normalYAbs at threshold boundary (0.25) for gray zone vertices
- Test that jeans garments ignore normalYAbs entirely
- Test that oxford shirt arm coverage is unchanged

### Property-Based Tests

- Generate random gray zone vertices (armScore 1.0–1.3) with high normalYAbs (>0.25) and verify covered=true after fix
- Generate random vertices outside gray zone and verify identical results to original function
- Generate random garment configs and verify sleeveEnd + gray zone logic interact correctly
- Generate random jeans inputs and verify arm detection has zero effect

### Integration Tests

- Render T-shirt heatmap and verify no visible gap at armpit/flank boundary
- Render T-shirt and verify actual arm vertices below sleeveEnd are still excluded
- Switch between T-shirt and Oxford shirt and verify correct coverage for both
- Verify edge fade smoothness at the gray zone boundary
