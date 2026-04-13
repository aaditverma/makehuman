# Session Handoff 004 — 2026-04-13

## Summary
Phase 2 garment shell implementation: size chart engine, Blender garment baking pipeline, GarmentShell runtime component, separate garment shell toggle. Parametric garment POC renders on body but needs pre-made models for production quality.

## What Changed

### Size Chart Engine (spec: `.kiro/specs/garment-shell-phase2/`)
- NEW: `src/utils/sizeChartEngine.ts` — BrandSizeChart/SizeMeasurements interfaces, validation, parsing, serialization, getActiveSizeChart()
- NEW: `src/data/defaultSizeCharts.ts` — extracted default size chart data (single source of truth)
- NEW: `src/utils/__tests__/sizeChartEngine.test.ts` — 24 tests (7 property-based + 11 unit + 6 integration)
- `src/utils/heatmapEngine.ts` — added optional `sizeChartOverride` parameter to `computeHeatmap()`

### Blender Garment Pipeline
- NEW: `scripts/bake-garments.py` — full pipeline: parametric garment pattern creation → surface projection onto body → morph target baking per body variant → GLB export
- Coordinate system: body imported from GLB has Z-up in Blender, garment patterns created in Z-up, exported with `export_yup=True` for Y-up GLB
- Generated: `public/models/garments/garment-tee-M.glb` (995 verts, 8 shape keys, 97KB)
- Cloth simulation attempted but garment flies off (-20m in Z) — fell back to surface projection approach
- Morph target displacements now correct (1mm to 86mm range)

### GarmentShell Runtime Component
- NEW: `src/components/GarmentShell.tsx` — loads garment GLB via GLTFLoader, syncs morph targets with body, semi-transparent material (0xaaaacc, opacity 0.7), console logging for debugging
- `src/stores/bodyStore.ts` — added `garmentShellEnabled`, `brandSizeChart`, `currentMorphInfluences` fields
- `src/components/UI/ControlPanel.tsx` — added separate "Garment Shell" toggle (purple ON/OFF button)
- `src/components/Scene.tsx` — added `<GarmentShell />` as sibling to `<BodyModel />`
- `src/components/BodyModel.tsx` — exposes morph influences to store via `setCurrentMorphInfluences()`, heatmap restored to always render on body

### Agent Hooks Created
- `test-on-save` — runs vitest when TS/TSX files saved
- `ts-error-check` — checks TypeScript diagnostics on save
- `test-after-task` — runs tests after spec task completion

### Project Master Updates
- Added production readiness section under External Tools (SMPL licensing, ML draping, datasets, fabric physics, population diversity)

## Known Issues
- **Parametric garment shapes are basic tubes** — not production quality. Need pre-made garment models from Marvelous Designer/CLO3D/Blender for realistic clothing
- **Blender cloth simulation broken** — garment flies off during sim (coordinate space mismatch between garment and body collision mesh). Surface projection used as fallback
- **Garment GLB only exists for tee M** — other garment/size combos will silently fail to load
- **Garment shell position slightly off** — shifted 1cm backward as quick fix, needs proper alignment
- **Most morph variants show zero displacement** — BVH nearest-point lookup doesn't capture body shape changes well for floating garment geometry

## Next Steps
- Start design-first spec for realistic garment models (pre-made in fashion design tools)
- Evaluate Marvelous Designer / CLO3D / Blender cloth sim workflow for garment creation
- Fix Blender cloth simulation coordinate space issue
- Generate garment GLBs for all 4 types × all sizes
