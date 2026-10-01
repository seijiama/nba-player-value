#!/usr/bin/env python3
"""Turn the notebook's prediction export into all-seasons-values.csv.

The notebook writes one row per player-season with both models side by side
(pred_with_age, pred_no_age, both as fractions of the cap). The site's build
step wants one row per player-season per model, in dollars. This script does
that reshape.

Usage (from the repo root):

    python scripts/make_values_csv.py path/to/nba_model_predictions_with_2026.csv

Then run `python scripts/build_data.py` to rebuild data/*.json.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import CAPS, DEFAULT_CSV  # noqa: E402

# notebook column -> model id used on the site
MODEL_COLUMNS = {"pred_with_age": "market", "pred_no_age": "production"}
SPLIT_NAMES = {"train": "train", "test": "test", "2026": "projection"}


def main(src: Path, dest: Path = DEFAULT_CSV) -> None:
    df = pd.read_csv(src)
    df = df.rename(columns={"Year": "Season"})
    df["Season"] = df["Season"].astype(int)
    df["Team"] = df["abv"].fillna(df["Team"])  # abv holds the normalized codes (CHA, BKN, PHX)
    df["Age"] = df["Age"].round().astype("Int64")
    df["G"] = df["G"].round().astype("Int64")
    df["split"] = df["split"].astype(str).map(SPLIT_NAMES).fillna(df["split"].astype(str))

    missing = sorted(set(df["Season"]) - set(CAPS))
    if missing:
        raise SystemExit(f"No cap for season(s) {missing}; add them to CAPS in build_data.py")
    cap = df["Season"].map(CAPS)

    frames = []
    for col, model in MODEL_COLUMNS.items():
        out = df[["Season", "Player", "Team", "Pos", "Age", "G", "MP", "PTS", "TRB", "AST", "Salary", "split"]].copy()
        out.insert(1, "model", model)
        out["pred_salary"] = (df[col] * cap).round()
        out["residual"] = ((df["Salary"] - out["pred_salary"]) / cap).round(6)
        frames.append(out)

    values = pd.concat(frames).sort_values(["Season", "Player", "model"])
    values = values[["Season", "model", "Player", "Team", "Pos", "Age", "G", "MP", "PTS",
                     "TRB", "AST", "Salary", "pred_salary", "residual", "split"]]
    values["Salary"] = values["Salary"].round().astype("Int64")
    values["pred_salary"] = values["pred_salary"].astype("Int64")
    values.to_csv(dest, index=False)
    print(f"Wrote {dest} ({len(values)} rows, {values['Season'].nunique()} seasons)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
