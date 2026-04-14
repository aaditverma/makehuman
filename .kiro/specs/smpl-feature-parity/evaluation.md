# Engine Migration Evaluation: SMPL vs MakeHuman

## Purpose

This document evaluates the SMPL and MakeHuman body engines after achieving full feature parity (Requirements 1–8 of the SMPL Feature Parity spec). The goal is to recommend an architectural path forward for the clothing fit visualization product targeting Shopify integration.

## Comparison Matrix

| Dimension | MakeHuman | SMPL | Winner |
|-----------|-----------|------|--------|
| **Visual Quality** | 214k vertices, hand-crafted morphs, skin texture with proper UV mapping | 165k vertices, PCA-based shape space, basic UV mapping | MakeHuman (marginal) |
| **Measurement Accuracy** | ANSUR II lookup → morph targets (indirect mapping, z-score heuristics) | ANSUR II lookup → 10 beta PCs + iterative refinement loop (<3cm convergence) | SMPL |
| **File Size** | ~56 MB GLB (25 morph targets) | ~94.4 MB GLB (20 morph targets, paired pos/neg) | MakeHuman |
| **Rendering Performance** | 214k vertices, 25 morph targets driven per frame | 165k vertices, 20 morph targets driven per frame | SMPL (fewer vertices) |
| **Feature Completeness** | Body type presets, body composition, custom measurements, heatmap, estimated measurements, smooth animations, facial features, 25 hand-crafted morphs | Body type presets, body composition, custom measurements, heatmap, estimated measurements, smooth animations, standardized topology | Tie (feature parity achieved, different extras) |
| **Shape Space Coverage** | 25 hand-crafted morphs — limited to artist-defined deformations | 10 PCA components trained on 10k+ 3D body scans — continuous shape space | SMPL |
| **Topology Consistency** | Variable topology across morph combinations | Standardized 6,890 base vertices — consistent across all shapes | SMPL |
| **Garment Fitting** | Morph-sync fallback, vertex correspondence varies with morphs | Standardized vertex indices enable reliable barycentric binding | SMPL |
| **Client-Side Operation** | Fully client-side, no external dependencies | Fully client-side (forward pass in TS, lookup table regressor) | Tie |
| **Extensibility (Female/Gender)** | Requires separate FBX export + morph pipeline per gender | Same SMPL architecture, swap model weights — additive infrastructure ready | SMPL |

## Detailed Analysis

### Visual Quality

MakeHuman has a slight edge in visual quality due to its higher vertex count (214k vs 165k) and hand-crafted morph targets that were artistically tuned. The skin texture UV mapping is more refined. However, for a clothing fit visualization product, the body is typically partially occluded by garments, and the visual difference at typical viewing distances is negligible. SMPL's PCA-based deformations produce anatomically plausible shapes across the entire parameter space, whereas MakeHuman morphs can produce artifacts at extreme combinations.

### Measurement Accuracy

SMPL is significantly better for measurement accuracy. The iterative refinement loop converges custom measurements to within 3cm of user targets — a hard guarantee backed by property tests. MakeHuman relies on indirect z-score mapping through 25 morph targets, where the relationship between morph influence and actual body circumference is approximate. For a product whose core value proposition is "does this garment fit me?", measurement accuracy is the most important dimension.

### File Size

MakeHuman's GLB is ~56 MB vs SMPL's ~94.4 MB. The 38 MB difference matters for Shopify embed load times. However, this can be mitigated:
- SMPL's base mesh is only 6,890 vertices — the 165k comes from 2x subdivision in Blender. A lower subdivision or runtime subdivision could reduce the GLB to ~25 MB.
- Morph target compression (Draco/meshopt) could reduce both, but SMPL benefits more from its regular topology.
- The SMPL browser binary (`smpl_model.bin`) is only 1.58 MB and could replace the GLB entirely if we move to runtime mesh generation.

### Rendering Performance

SMPL renders fewer vertices per frame (165k vs 214k) and drives fewer morph targets (20 vs 25). In practice, both are well within real-time budgets on modern hardware. The difference is ~20% fewer GPU vertices for SMPL, which matters more on mobile devices — a key consideration for Shopify embeds.

### Garment Fitting (Critical for Product)

This is where SMPL has a decisive advantage. SMPL's standardized topology means vertex indices are consistent across all body shapes. Garment binding maps computed once work for every body configuration. MakeHuman's morph targets change vertex positions in ways that can break barycentric bindings at extreme morph combinations, requiring the morph-sync fallback path. For Phase 2/3 garment visualization, SMPL's topology is fundamentally better suited.

## Remaining MakeHuman-Only Capabilities

### 1. Facial Features
MakeHuman has facial morph targets (DoubleChin, and general face shape). SMPL has no facial deformation capability.

**Assessment: Low importance.** The product is a clothing fit visualizer. Facial features have zero impact on garment fit. Users don't need facial customization to evaluate whether a shirt fits their torso. If facial features become important (e.g., for neckwear or accessories), they could be added as a separate face mesh overlay.

### 2. Specific Morph Targets (25 vs 10 PCs)
MakeHuman has 25 named morphs (BellyPouch, LoveHandles, BackFat, UpperArmSag, etc.) that target specific body regions. SMPL's 10 PCA components are global — each affects the entire body.

**Assessment: Medium importance, but SMPL compensates.** The named morphs give fine-grained control over specific fat deposits and regional shape. However, SMPL's PCA components were trained on 10k+ real body scans, so the 10 components capture the most statistically significant shape variations. The iterative refinement loop compensates by adjusting betas until specific measurements match. For clothing fit (which cares about circumferences, not fat distribution), SMPL's approach is sufficient. Regional fat distribution affects visual realism but not fit accuracy.

### 3. Higher Vertex Count (214k vs 165k)
MakeHuman's 2x subdivision produces smoother surfaces.

**Assessment: Low importance.** The difference is not visible at typical viewing distances in a Shopify embed. SMPL could be subdivided further if needed, at the cost of file size.

### 4. Refined UV Mapping
MakeHuman's UV mapping was hand-tuned for the skin texture.

**Assessment: Low importance.** SMPL has basic UV mapping that works with the skin texture. For a product where the body is often partially covered by garments, UV quality is secondary.

## Recommendation: Migrate to SMPL-Only

**Recommended path: Deprecate MakeHuman and migrate to SMPL-only.**

### Justification

1. **Measurement accuracy is the product's core value.** SMPL's iterative refinement with <3cm convergence guarantee directly serves the "does this garment fit?" question. MakeHuman's indirect morph mapping cannot provide this guarantee.

2. **Garment fitting requires consistent topology.** SMPL's standardized vertex indices are essential for reliable garment deformation in Phase 2/3. Maintaining two topology-incompatible engines doubles the garment pipeline complexity.

3. **Shape space coverage is superior.** SMPL's PCA space trained on 10k+ scans covers real human body variation better than 25 hand-crafted morphs. This matters for a global Shopify audience with diverse body types.

4. **Female/gender extension is straightforward.** SMPL's architecture supports gender as a model weight swap. MakeHuman requires a completely separate FBX export and morph pipeline.

5. **Dual engine maintenance cost is high.** Every feature (heatmap, measurements, animation, garment binding) must be implemented and tested twice. The SMPL Feature Parity spec itself is evidence of this cost — 14 tasks just to bring SMPL to parity.

6. **MakeHuman-only capabilities are non-critical.** Facial features and regional fat morphs don't affect clothing fit accuracy, which is the product's value proposition.

### What We Lose

- Facial features (not needed for clothing fit)
- ~38 MB smaller initial load (mitigable with SMPL optimizations)
- Slightly higher visual fidelity at extreme close-up (not the typical use case)

## Migration Plan

### Phase 1: Soft Deprecation (Immediate)
1. Set SMPL as the default engine in `bodyStore.ts` (change `bodyEngine` default from `'makehuman'` to `'smpl'`)
2. Keep the engine toggle in the UI but add a "(Legacy)" label to MakeHuman
3. Stop adding new features to the MakeHuman path
4. Update `PROJECT_MASTER.md` to reflect SMPL as the primary engine

### Phase 2: File Size Optimization (1–2 weeks)
1. Evaluate runtime subdivision: generate SMPL mesh from the 6,890-vertex base mesh + morph targets at runtime, eliminating the pre-subdivided GLB
2. If runtime subdivision is too slow, apply meshopt/Draco compression to the GLB
3. Target: SMPL total payload under 60 MB (competitive with MakeHuman's 56 MB)
4. Alternatively, explore streaming the SMPL binary (1.58 MB) and generating the mesh entirely in the browser via the forward pass — this would reduce initial load to under 5 MB

### Phase 3: Garment Pipeline Consolidation (2–4 weeks)
1. Remove MakeHuman-specific garment binding paths from `garmentDeformer.ts`
2. Standardize all garment binding maps on SMPL topology
3. Remove morph-sync fallback from `GarmentShell.tsx` (only needed for MakeHuman)
4. Update `bake-garment-bindings.py` to only target SMPL mesh

### Phase 4: Full Removal (After Phase 3 validated)
1. Remove `MakeHumanEngine` class from `bodyEngine.ts`
2. Remove MakeHuman morph mapping from `morphMapper.ts`
3. Remove engine toggle from `ControlPanel.tsx` and `bodyStore.ts`
4. Remove `public/models/human-male.glb` and `public/models/male-base.fbx`
5. Remove `scripts/generate-morphs.py` (MakeHuman Blender script)
6. Remove MakeHuman-specific branches from `BodyModel.tsx` and `heatmapEngine.ts`
7. Update all tests to remove MakeHuman engine references
8. Update `PROJECT_MASTER.md` to reflect single-engine architecture

### Risk Mitigation
- **Keep MakeHuman GLB in git history** — can be restored if SMPL-only migration reveals unforeseen issues
- **Run A/B comparison** before Phase 4: show both engines to a small user group and compare fit accuracy feedback
- **File size regression testing**: add a CI check that SMPL payload stays under the target threshold

## Summary

SMPL is the better engine for a clothing fit visualization product. Its measurement accuracy, standardized topology, and extensibility outweigh MakeHuman's marginal visual quality advantage and smaller file size. The dual engine architecture served its purpose as a migration bridge, but maintaining it long-term doubles development cost without proportional user benefit. The recommended path is a phased migration to SMPL-only, with file size optimization as the key technical challenge.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4**
