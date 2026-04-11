"""
Train gradient boosting models on ANSUR II + multiple NHANES cycles + bdims.
ANSUR II: 6068 subjects, 93 measurements
NHANES 2011-2018: ~20,000 adults, waist + hip
bdims: 507 subjects, 21 body measurements
"""
import os, json, urllib.request
import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import cross_val_score

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "data")

# ── Load ANSUR II ────────────────────────────────────────
print("=== Loading ANSUR II ===")
male_df = pd.read_csv(os.path.join(DATA_DIR, "ansur2_male.csv"), encoding='latin-1')
female_df = pd.read_csv(os.path.join(DATA_DIR, "ansur2_female.csv"), encoding='latin-1')
male_df['gender'] = 1
female_df['gender'] = 0
ansur = pd.concat([male_df, female_df], ignore_index=True)

ansur_clean = pd.DataFrame({
    'height_cm': ansur['stature'] / 10,
    'weight_kg': ansur['weightkg'] / 10,
    'age': ansur['Age'],
    'gender': ansur['gender'],
    'chestCm': ansur['chestcircumference'] / 10,
    'waistCm': ansur['waistcircumference'] / 10,
    'hipCm': ansur['buttockcircumference'] / 10,
    'shoulderCm': ansur['biacromialbreadth'] / 10,
    'neckCm': ansur['neckcircumference'] / 10,
    'bicepCm': ansur['bicepscircumferenceflexed'] / 10,
    'thighCm': ansur['thighcircumference'] / 10,
    'calfCm': ansur['calfcircumference'] / 10,
    'wristCm': ansur['wristcircumference'] / 10,
    'inseamCm': ansur['crotchheight'] / 10,
    'source': 'ansur2',
})
print(f"  ANSUR II: {len(ansur_clean)} subjects")

# ── Load multiple NHANES cycles ──────────────────────────
print("\n=== Loading NHANES cycles ===")
import pyreadstat

nhanes_cycles = [
    ('2011-2012', 'BMX_G', 'DEMO_G'),
    ('2013-2014', 'BMX_H', 'DEMO_H'),
    ('2015-2016', 'BMX_I', 'DEMO_I'),
    ('2017-2018', 'BMX_J', 'DEMO_J'),
]

all_nhanes = []

for cycle, bmx_name, demo_name in nhanes_cycles:
    bmx_path = os.path.join(DATA_DIR, f"nhanes_{bmx_name}.xpt")
    demo_path = os.path.join(DATA_DIR, f"nhanes_{demo_name}.xpt")
    
    bmx_url = f"https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/{cycle.split('-')[0]}/DataFiles/{bmx_name}.XPT"
    demo_url = f"https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/{cycle.split('-')[0]}/DataFiles/{demo_name}.XPT"
    
    for url, path, label in [(bmx_url, bmx_path, f"BMX {cycle}"), (demo_url, demo_path, f"DEMO {cycle}")]:
        if not os.path.exists(path):
            print(f"  Downloading {label}...")
            try:
                urllib.request.urlretrieve(url, path)
            except Exception as e:
                print(f"    Failed: {e}")
                continue
    
    if not os.path.exists(bmx_path) or not os.path.exists(demo_path):
        print(f"  Skipping {cycle} - files missing")
        continue
    
    bmx, _ = pyreadstat.read_xport(bmx_path)
    demo, _ = pyreadstat.read_xport(demo_path)
    
    merged = bmx.merge(demo[['SEQN', 'RIDAGEYR', 'RIAGENDR']], on='SEQN', how='left')
    merged = merged[merged['RIDAGEYR'] >= 18].copy()
    
    cycle_df = pd.DataFrame({
        'height_cm': merged.get('BMXHT'),
        'weight_kg': merged.get('BMXWT'),
        'age': merged.get('RIDAGEYR'),
        'gender': (merged.get('RIAGENDR') == 1).astype(int),
        'waistCm': merged.get('BMXWAIST'),
        'hipCm': merged.get('BMXHIP'),
        'source': f'nhanes_{cycle}',
    })
    cycle_df = cycle_df.dropna(subset=['height_cm', 'weight_kg', 'age', 'gender'])
    all_nhanes.append(cycle_df)
    print(f"  NHANES {cycle}: {len(cycle_df)} adults")

nhanes_combined = pd.concat(all_nhanes, ignore_index=True) if all_nhanes else pd.DataFrame()
print(f"  Total NHANES: {len(nhanes_combined)} adults")

# ── Load bdims dataset ───────────────────────────────────
print("\n=== Loading bdims dataset ===")
bdims_url = "https://vincentarelbundock.github.io/Rdatasets/csv/openintro/bdims.csv"
bdims_path = os.path.join(DATA_DIR, "bdims.csv")
if not os.path.exists(bdims_path):
    print("  Downloading bdims...")
    urllib.request.urlretrieve(bdims_url, bdims_path)

bdims_df = pd.DataFrame()
if os.path.exists(bdims_path):
    raw = pd.read_csv(bdims_path)
    print(f"  bdims columns: {list(raw.columns)[:20]}")
    
    # bdims uses specific column names - map them
    # Common columns: age, wgt (weight kg), hgt (height cm), sex (1=male, 0=female)
    # Girths: che.gi (chest), wai.gi (waist), hip.gi (hip), thi.gi (thigh),
    #         bic.gi (bicep), for.gi (forearm), kne.gi (knee), cal.gi (calf),
    #         ank.gi (ankle), wri.gi (wrist), nav.gi (navel)
    # Diameters: bii.di (biiliac/hip width), bia.di (biacromial/shoulder width)
    col_map = {}
    for col in raw.columns:
        cl = col.lower().replace('.', '_')
        col_map[col] = cl
    raw = raw.rename(columns=col_map)
    
    print(f"  Mapped columns: {list(raw.columns)[:25]}")
    
    bdims_df = pd.DataFrame({
        'height_cm': raw.get('hgt'),
        'weight_kg': raw.get('wgt'),
        'age': raw.get('age'),
        'gender': raw.get('sex'),
        'chestCm': raw.get('che_gi'),
        'waistCm': raw.get('wai_gi'),
        'hipCm': raw.get('hip_gi'),
        'shoulderCm': raw.get('bia_di'),
        'bicepCm': raw.get('bic_gi'),
        'thighCm': raw.get('thi_gi'),
        'calfCm': raw.get('cal_gi'),
        'wristCm': raw.get('wri_gi'),
        'source': 'bdims',
    })
    bdims_df = bdims_df.dropna(subset=['height_cm', 'weight_kg', 'age', 'gender'])
    print(f"  bdims: {len(bdims_df)} subjects")

# ── Combine all datasets ─────────────────────────────────
print("\n=== Combining datasets ===")
all_dfs = [ansur_clean]
if len(nhanes_combined) > 0:
    all_dfs.append(nhanes_combined)
if len(bdims_df) > 0:
    all_dfs.append(bdims_df)

combined = pd.concat(all_dfs, ignore_index=True)
combined['bmi'] = combined['weight_kg'] / (combined['height_cm'] / 100) ** 2
combined = combined[(combined['bmi'] > 14) & (combined['bmi'] < 65)]
combined = combined[(combined['height_cm'] > 135) & (combined['height_cm'] < 220)]

print(f"Total combined: {len(combined)} subjects")
print(f"  BMI range: {combined['bmi'].min():.1f} - {combined['bmi'].max():.1f}")
print(f"  Height range: {combined['height_cm'].min():.1f} - {combined['height_cm'].max():.1f}")
print(f"  Weight range: {combined['weight_kg'].min():.1f} - {combined['weight_kg'].max():.1f}")

# Count per source
for src in combined['source'].unique():
    print(f"  {src}: {len(combined[combined['source'] == src])}")

# ── Train Gradient Boosting ──────────────────────────────
features = ['height_cm', 'weight_kg', 'age', 'gender', 'bmi']

targets = {
    'chestCm': False,   # bdims has chest too
    'waistCm': False,
    'hipCm': False,
    'shoulderCm': False, # bdims has shoulder
    'neckCm': True,      # ANSUR only
    'bicepCm': False,    # bdims has bicep
    'thighCm': False,    # bdims has thigh
    'calfCm': False,     # bdims has calf
    'wristCm': False,    # bdims has wrist
    'inseamCm': True,    # ANSUR only
}

gb_models = {}
results = {}

print("\nTraining Gradient Boosting models:")
for name, ansur_only in targets.items():
    if ansur_only:
        train_df = combined[combined['source'] == 'ansur2'].dropna(subset=features + [name])
    else:
        train_df = combined.dropna(subset=features + [name])
    
    if len(train_df) < 50:
        print(f"  {name:15s}: SKIPPED (only {len(train_df)} samples)")
        continue
    
    X = train_df[features].values
    y = train_df[name].values
    
    model = GradientBoostingRegressor(
        n_estimators=300, max_depth=5, learning_rate=0.08,
        min_samples_leaf=10, subsample=0.8, random_state=42
    )
    scores = cross_val_score(model, X, y, cv=5, scoring='neg_mean_absolute_error')
    mae = -scores.mean()
    
    model.fit(X, y)
    gb_models[name] = model
    results[name] = {'mae_cm': round(mae, 2), 'mean': round(y.mean(), 1), 'std': round(y.std(), 1), 'n': len(train_df)}
    print(f"  {name:15s}: MAE={mae:.2f}cm, n={len(train_df)}")

# ── Generate lookup table ────────────────────────────────
print("\nGenerating lookup table...")

heights = list(range(140, 211, 5))
weights = list(range(35, 181, 5))  # extended to 180kg
ages = [20, 30, 40, 50, 60]
genders = [0, 1]

lookup = {}
total_points = 0

for gender in genders:
    gkey = "male" if gender == 1 else "female"
    lookup[gkey] = {}
    for age in ages:
        akey = str(age)
        lookup[gkey][akey] = {}
        grid = []
        for h in heights:
            for w in weights:
                bmi = w / (h / 100) ** 2
                if bmi < 12 or bmi > 65:
                    continue
                grid.append([h, w, age, gender, bmi])
        if not grid:
            continue
        X_grid = np.array(grid)
        preds = {name: model.predict(X_grid) for name, model in gb_models.items()}
        for i, row in enumerate(grid):
            h, w = int(row[0]), int(row[1])
            hk, wk = str(h), str(w)
            if hk not in lookup[gkey][akey]:
                lookup[gkey][akey][hk] = {}
            entry = {name: round(preds[name][i], 1) for name in gb_models}
            lookup[gkey][akey][hk][wk] = entry
            total_points += 1

print(f"  Grid points: {total_points}")

# ── Population stats ─────────────────────────────────────
pop_stats = {}
for gv, gn in [(1, "male"), (0, "female")]:
    gdf = combined[combined['gender'] == gv]
    stats = {}
    for name in gb_models:
        vals = gdf[name].dropna().values
        if len(vals) > 0:
            stats[name] = {"mean": round(vals.mean(), 1), "std": round(vals.std(), 1)}
    for col, label in [('height_cm', 'heightCm'), ('weight_kg', 'weightKg'), ('bmi', 'bmi')]:
        vals = gdf[col].dropna().values
        if len(vals) > 0:
            stats[label] = {"mean": round(vals.mean(), 1), "std": round(vals.std(), 1)}
    pop_stats[gn] = stats

# ── Export ────────────────────────────────────────────────
export = {
    "meta": {
        "source": "ANSUR II + NHANES 2011-2018 + bdims",
        "totalSubjects": len(combined),
        "model": "GradientBoosting (n=300, depth=5)",
        "gridHeights": heights,
        "gridWeights": list(range(35, 181, 5)),
        "gridAges": ages,
    },
    "lookup": lookup,
    "populationStats": pop_stats,
    "modelAccuracy": results,
}

out_path = os.path.join(DATA_DIR, "ansur2_model.json")
with open(out_path, 'w') as f:
    json.dump(export, f)

print(f"\nExported to {out_path} ({os.path.getsize(out_path) / 1024:.0f} KB)")
