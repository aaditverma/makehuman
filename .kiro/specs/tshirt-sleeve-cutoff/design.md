# T-Shirt Sleeve Cutoff Bugfix Design

## Overview

The heatmap engine's `getVertexFit()` function cannot distinguish arm vertices from lower back vertices when applying sleeve cutoff. Both regions share overlapping positional values (`distFromCenter`, `xAbs`) at the sleeve cutoff height (~0.60). The fix uses vertex normals to classify arm vs torso vertices: arm vertices face outward (high absolute X normal), while back/front torso vertices face along the Z axis. This requires passing normal data from `BodyModel.tsx` into the heatmap engine and adding a normal-based arm detection check to `getVertexFit()`.

## Glossary

- **Bug_Condition (C)**: A vertex is an arm vertex below `sleeveEnd` height, but the engine treats it as covered because it cannot distinguish it from a torso vertex
- **Property (P)**: Arm vertices below `sleeveEnd` should be uncovered; torso vertices at the same height should remain covered
- **Preservation**: All existing garment coverage (oxford shirt, jeans, neckline, hem fade, hand exclusion) must remain unchanged
- **`getVertexFit()`**: The function in `src/utils/heatmapEngine.ts` that determines if a vertex is covered by a garment and its fit score
- **`sleeveEnd`**: Normalized height where sleeves end (0.60 for tee, 0.48 for oxford). Lower value = longer sleeve
- **Vertex Normal**: Unit vector perpendicular to the mesh surface at a vertex. Arm normals point outward (high |Nx|), back normals point +Z, front normals point -Z
- **`normalXAbs`**: Absolute value of the vertex normal's X component, used to classify arm vs torso

## Bug Details

### Bug Condition

The bug manifests when the T-shirt garment is selected and the engine attempts to apply sleeve cutoff. The `getVertexFit()` function receives only position data (`normalizedHeight`, `xAbs`, `yPos`, `distFromCenter`), which cannot distinguish arm vertices from lower back vertices that share similar positional values at the sleeve cutoff height range. As a result, the `sleeveEnd` property is unused for coverage — it only affects edge fade.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { vertex: Vec3, normal: Vec3, garment: GarmentSizeChart }
  OUTPUT: boolean

  LET h = normalizedHeight(input.vertex)
  LET normalXAbs = abs(input.normal.x)
  LET isArm = normalXAbs > 0.5
  LET sleeveEnd = input.garment.sleeveEnd

  RETURN sleeveEnd IS DEFINED
         AND isArm
         AND h < sleeveEnd
         AND getVertexFit_current(h, ...) reports covered = true
END FUNCTION
```

### Examples

- **Arm at elbow height (h=0.55)**: Normal ~(±0.9, 0.1, 0.2). Should be uncovered by tee (sleeveEnd=0.60), but currently shows as covered. `distFromCenter ≈ 0.15`, similar to lower back vertices.
- **Lower back at same height (h=0.55)**: Normal ~(0.1, 0.0, 0.8). Should remain covered by tee. `distFromCenter ≈ 0.12`, overlaps with arm range.
- **Front torso at same height (h=0.55)**: Normal ~(0.1, 0.0, -0.8). Should remain covered by tee.
- **Arm at shoulder height (h=0.70)**: Normal ~(±0.85, 0.2, 0.1). Should be covered by tee (above sleeveEnd=0.60). No change needed.
- **Oxford shirt arm at wrist (h=0.50)**: Normal ~(±0.9, 0.1, 0.1). Should remain covered (oxford sleeveEnd=0.48). Fix must not break this.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Oxford shirt coverage: full torso front+back, long sleeves to sleeveEnd=0.48
- Jeans coverage: full legs from ankles to waist with correct edge fades
- Neckline cutout logic for all top garments
- Hand exclusion zones (distFromCenter > 0.22 && h < 0.52)
- Hem edge fade at garment bottom boundary
- Sleeve edge fade near sleeveEnd (existing fade logic stays, now applied correctly)
- Fit score calculation (tight/balanced/loose) for all garments
- All bottom garment behavior (no normals involved)

**Scope:**
All inputs where the vertex is NOT an arm vertex below sleeveEnd should be completely unaffected. This includes:
- All torso vertices (front and back) at any height
- All arm vertices above sleeveEnd
- All bottom garment vertices
- All non-heatmap rendering

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Missing vertex classification data**: `getVertexFit()` only receives position-based parameters (`normalizedHeight`, `xAbs`, `yPos`, `distFromCenter`). At the sleeve cutoff height (~0.60), arm vertices and lower back vertices have overlapping `distFromCenter` (both ~0.10–0.16) and `xAbs` values, making them indistinguishable.

2. **`sleeveEnd` unused for coverage**: The `sleeveEnd` property is only used in the edge fade calculation (line ~160 in heatmapEngine.ts), not in the coverage check. There is no code path that marks arm vertices below `sleeveEnd` as uncovered.

3. **No arm detection mechanism**: The engine has no way to determine if a vertex belongs to an arm vs the torso. Vertex normals provide this signal — arm vertices face outward (high |Nx|), torso vertices face forward/backward (high |Nz|).

## Correctness Properties

Property 1: Bug Condition - Arm Vertices Below SleeveEnd Are Uncovered

_For any_ vertex where the vertex normal indicates it is an arm vertex (|normal.x| > threshold) AND the normalized height is below the garment's `sleeveEnd` value, the fixed `getVertexFit()` SHALL return `covered: false`, correctly excluding the arm vertex from the garment's coverage area.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Torso Vertices Remain Covered

_For any_ vertex where the vertex normal indicates it is a torso vertex (|normal.x| ≤ threshold, i.e. front or back facing) AND the vertex is within the garment's height coverage range, the fixed `getVertexFit()` SHALL return the same `covered`, `fitScore`, and `edgeFade` values as the original function, preserving full torso coverage including the lower back.

**Validates: Requirements 3.1, 3.2, 3.4**

## Fix Implementation

### Changes Required

**File**: `src/utils/heatmapEngine.ts`

1. **Add `normalXAbs` parameter to `getVertexFit()`**: Extend the function signature to accept the absolute X component of the vertex normal. Update the `HeatmapResult` interface accordingly.

2. **Add arm detection using normal threshold**: Inside `getVertexFit()`, classify a vertex as "arm" when `normalXAbs > 0.5` (arm normals face outward with high X component). This threshold cleanly separates arm vertices from torso vertices.

3. **Add sleeve cutoff coverage check**: For top garments with a `sleeveEnd` property, if the vertex is classified as arm AND `normalizedHeight < sleeveEnd`, return `covered: false`. This goes in the top garment coverage section, after the existing neckline/hand checks.

4. **Keep existing edge fade logic**: The sleeve edge fade near `sleeveEnd` already exists and will now correctly apply to the boundary between covered and uncovered arm regions.

**File**: `src/components/BodyModel.tsx`

5. **Extract vertex normals in heatmap effect**: In the heatmap `useEffect`, read the geometry's `normal` attribute alongside the `position` attribute. For each vertex, compute `normalXAbs = Math.abs(normal.getX(i))`.

6. **Pass `normalXAbs` to `getVertexFit()`**: Update the call to `heatmap.getVertexFit()` to include the computed `normalXAbs` value as the fifth argument.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that arm vertices below sleeveEnd are incorrectly marked as covered.

**Test Plan**: Create test inputs with known vertex positions and normals at the sleeve cutoff boundary. Run `getVertexFit()` on unfixed code to observe that arm vertices below sleeveEnd return `covered: true`.

**Test Cases**:
1. **Arm vertex at h=0.55, normalXAbs=0.9**: Should be uncovered by tee (sleeveEnd=0.60), but unfixed code returns covered=true
2. **Arm vertex at h=0.50, normalXAbs=0.85**: Well below sleeveEnd, unfixed code returns covered=true
3. **Arm vertex at h=0.59, normalXAbs=0.7**: Just below sleeveEnd boundary, unfixed code returns covered=true

**Expected Counterexamples**:
- All arm vertices below sleeveEnd return `covered: true` because the unfixed code has no arm detection and ignores `sleeveEnd` for coverage

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL vertex WHERE isBugCondition(vertex) DO
  result := getVertexFit_fixed(h, xAbs, yPos, distFromCenter, normalXAbs)
  ASSERT result.covered = false
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL vertex WHERE NOT isBugCondition(vertex) DO
  ASSERT getVertexFit_original(h, xAbs, yPos, distFromCenter)
       = getVertexFit_fixed(h, xAbs, yPos, distFromCenter, normalXAbs)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random vertex positions and normals across the full input domain
- It catches edge cases at the arm/torso boundary that manual tests might miss
- It provides strong guarantees that torso coverage is unchanged

**Test Plan**: Observe behavior on UNFIXED code first for torso vertices and non-arm inputs, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Back vertex preservation (h=0.55, normalXAbs=0.1)**: Verify back vertices at sleeve cutoff height remain covered after fix
2. **Front torso preservation (h=0.55, normalXAbs=0.15)**: Verify front torso vertices remain covered
3. **Oxford shirt preservation**: Verify oxford shirt arm coverage unchanged (sleeveEnd=0.48, arms covered down to wrist)
4. **Jeans preservation**: Verify all jeans coverage completely unchanged (no normals involved)

### Unit Tests

- Test `getVertexFit()` with arm vertex below sleeveEnd → covered=false
- Test `getVertexFit()` with arm vertex above sleeveEnd → covered=true
- Test `getVertexFit()` with torso vertex at sleeveEnd height → covered=true
- Test `getVertexFit()` with boundary normalXAbs values near threshold
- Test that jeans garments ignore normalXAbs entirely

### Property-Based Tests

- Generate random vertices with normals and verify: arm vertices (normalXAbs > 0.5) below sleeveEnd are uncovered
- Generate random torso vertices (normalXAbs ≤ 0.5) and verify coverage matches original function
- Generate random garment configs and verify sleeveEnd is respected for arm classification

### Integration Tests

- Render T-shirt heatmap and verify arm vertices below h=0.60 are uncovered while back is fully covered
- Render Oxford shirt and verify no change in coverage
- Switch between T-shirt and Oxford shirt and verify correct sleeve lengths
