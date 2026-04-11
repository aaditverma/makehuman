import json
import numpy as np
from sklearn.preprocessing import PolynomialFeatures

with open('src/data/ansur2_model.json') as f:
    m = json.load(f)

# Test prediction for 175cm, 75kg, 28yo, male
raw = np.array([[175, 75, 28, 1, 24.489795918]])
poly = PolynomialFeatures(degree=2, include_bias=False)
features = poly.fit_transform(raw)[0]

print(f"Features ({len(features)}):")
for i, v in enumerate(features):
    print(f"  [{i}] = {v:.4f}")

print("\nPredictions:")
for name, model in m['models'].items():
    result = model['intercept']
    for i, c in enumerate(model['coefficients']):
        result += c * features[i]
    print(f"  {name}: {result:.1f} cm")
