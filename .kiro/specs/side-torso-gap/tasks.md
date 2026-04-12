# Implementation Plan: Side Torso Gap Bugfix

## Overview

Fix the T-shirt heatmap gap at the armpit/flank boundary caused by gray zone vertices (armScore 1.0–1.3) being incorrectly excluded from coverage. The fix adds `normalYAbs` as a secondary disambiguation signal to `getVertexFit()` — armpit/flank vertices have high `|normalY|` (>0.25, surface curves into armpit concavity) while actual arm vertices have low `|normalY|` (≤0.25, cylindrical outward-facing surface). Changes span `heatmapEngine.ts` (classification logic) and `BodyModel.tsx` (pass normalYAbs).

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Gray Zone Side Torso Vertices Missing Coverage
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate gray zone side-torso vertices are incorrectly excluded
  - **Scoped PBT Approach**: Scope the property to vertices with armScore in [1.0, 1.3] and normalYAbs > 0.25 (side-torso subset of gray zone)
  - Create test file `src/utils/__tests__/sideTorsoGap.test.ts`
  - Use `computeHeatmap()` to get a T-shirt heatmap result (garment='tee', size='M', fitPref='regular', plausible body measurements)
  - Use fast-check to generate random vertices satisfying the bug condition:
    - `normalXAbs` in [0.4, 0.8], `xAbs` in [0.08, 0.20] such that `armScore = normalXAbs + xAbs * 3` is in [1.0, 1.3]
    - `normalYAbs` in (0.25, 0.7] (armpit/flank concavity signal)
    - `h` in [0.44, 0.59] (below sleeveEnd=0.60, within tee coverage)
    - `yPos` (z-position) and `distFromCenter` as plausible values
  - Assert `covered === true` for all generated gray zone side-torso vertices (from Expected Behavior in design)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (confirms bug — these vertices return covered=false because normalYAbs is not used)
  - Document counterexamples found (e.g., "vertex at h=0.55, armScore=1.05, normalYAbs=0.35 returns covered=false")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Gray-Zone Vertex Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create preservation tests in the same test file `src/utils/__tests__/sideTorsoGap.test.ts`
  - Observe behavior on UNFIXED code for vertices outside the gray zone:
    - Deep torso vertices (armScore < 1.0): observe covered=true with correct fitScore/edgeFade
    - Clear arm vertices (armScore > 1.3, below sleeveEnd): observe covered=false
    - Vertices above sleeveEnd (h >= 0.60): observe covered=true regardless of armScore
    - Jeans vertices: observe coverage completely unaffected by arm detection
    - Oxford shirt vertices: observe full coverage including long sleeves
  - Write property-based tests with fast-check:
    - Generate random vertices with armScore < 1.0 (deep torso): assert same covered/fitScore/edgeFade from original function
    - Generate random vertices with armScore > 1.3 (clear arm) below sleeveEnd: assert covered=false
    - Generate random jeans inputs: assert arm detection has zero effect (compare tee vs jeans at same vertex)
    - Generate random oxford inputs: assert coverage unchanged
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for gray zone side-torso gap in T-shirt heatmap

  - [x] 3.1 Add `normalYAbs` parameter and refine gray zone classification in `src/utils/heatmapEngine.ts`
    - Add `normalYAbs` as 6th parameter to `getVertexFit()` signature (default 0)
    - Update `HeatmapResult` interface to include `normalYAbs?: number` in `getVertexFit()` signature
    - In the sleeve cutoff section, replace single `armScore > 1.3` check with tiered logic:
      - `armScore > 1.3` → uncovered (unchanged — clear arm)
      - `armScore >= 1.0 && armScore <= 1.3 && normalYAbs <= 0.25` → uncovered (gray zone arm)
      - `armScore >= 1.0 && armScore <= 1.3 && normalYAbs > 0.25` → covered (gray zone side torso — the fix)
      - `armScore < 1.0` → covered (unchanged — clear torso)
    - Update edge fade section: apply sleeve fade to gray zone arm vertices (`armScore in [1.0, 1.3] && normalYAbs <= 0.25`) in addition to clear arm vertices (`armScore > 1.3`)
    - _Bug_Condition: isBugCondition(input) where armScore in [1.0, 1.3] AND normalYAbs > 0.25 AND h < sleeveEnd_
    - _Expected_Behavior: covered=true for gray zone side-torso vertices (normalYAbs > 0.25)_
    - _Preservation: All vertices with armScore < 1.0 or armScore > 1.3 produce identical results_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.5, 3.6_

  - [x] 3.2 Extract and pass `normalYAbs` in `src/components/BodyModel.tsx`
    - In the heatmap `useEffect`, compute `normalYAbs = Math.abs(nor.getY(i))` alongside existing `normalXAbs`
    - Pass `normalYAbs` as the 6th argument to `heatmap.getVertexFit()` call
    - _Requirements: 2.2_

  - [x] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Gray Zone Side Torso Vertices Get Coverage
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (covered=true for gray zone side-torso vertices)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Gray-Zone Vertex Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full test suite (`npm test`)
  - Ensure all tests pass, ask the user if questions arise.
