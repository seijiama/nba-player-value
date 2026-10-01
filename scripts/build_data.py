#!/usr/bin/env python3
"""Validate all-seasons-values.csv and write the JSON files the site reads.

Usage (from the repo root):

    python scripts/build_data.py                    # reads all-seasons-values.csv
    python scripts/build_data.py path/to/file.csv   # or any CSV in the same format

Input: one row per player-season per model, with columns
    Season, model, Player, Team, Pos, Age, G, MP, PTS, TRB, AST,
    Salary, pred_salary, residual
and optionally `split` (train / test / projection).

    Season       season-end year (2025 = the 2024-25 season)
    model        "market" (age-aware) or "production" (age-blind)
    Salary       actual salary in dollars; blank if not known yet
    pred_salary  the model's predicted salary in dollars
    residual     (Salary - pred_salary) / cap for that season; blank if Salary is blank

Output:
    data/<season>-<model>.json   one file per season and model
    data/seasons.json            seasons, models, caps and teams the site can show

The script stops with a clear message if the CSV breaks any rule below, so a
bad file never reaches the site.
"""

from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT / "all-seasons-values.csv"
DATA_DIR = ROOT / "data"
# Written by scripts/add_salaries.py: where a season's salaries came from, when
# it isn't the training dataset. Shown in the site's methodology section.
SOURCES_FILE = ROOT / "salary-sources.json"

# NBA salary cap by season-end year, in dollars. Add a line here before you
# add a new season to the CSV - the build refuses seasons without a cap.
CAPS = {
    2016: 70_000_000,
    2017: 94_143_000,
    2018: 99_093_000,
    2019: 101_869_000,
    2020: 109_140_000,
    2021: 109_140_000,
    2022: 112_414_000,
    2023: 123_655_000,
    2024: 136_021_000,
    2025: 140_588_000,
    2026: 154_647_000,
}

MODELS = {
    "market": {
        "label": "Market value",
        "short": "Market",
        "r2": 0.71,
        "description": "Age-aware. Learns how the NBA actually pays.",
    },
    "production": {
        "label": "Production value",
        "short": "Production",
        "r2": 0.57,
        "description": "Age-blind. Closer to pure on-court worth.",
    },
}

REQUIRED = [
    "Season", "model", "Player", "Team", "Pos", "Age", "G", "MP",
    "PTS", "TRB", "AST", "Salary", "pred_salary", "residual",
]
# Columns that describe the player-season itself, so both model rows must agree.
SHARED = ["Team", "Pos", "Age", "G", "MP", "PTS", "TRB", "AST", "Salary"]

MIN_GAMES = 55
RESIDUAL_TOLERANCE = 1e-5  # in fractions of the cap (about $1,500 at a $150M cap)


class BuildError(Exception):
    pass


def fail(message: str) -> None:
    raise BuildError(message)


def player_id(name: str) -> str:
    """Stable id that ignores accents, so "Nikola Jokic" and "Nikola Jokić" match."""
    plain = unicodedata.normalize("NFD", name)
    plain = "".join(c for c in plain if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")


def canonical_names(df: pd.DataFrame) -> dict[str, str]:
    """One display name per player id: prefer the accented spelling, then the latest season's."""
    names: dict[str, str] = {}
    for name in df.sort_values("Season")["Player"]:
        pid = player_id(name)
        current = names.get(pid)
        # Later seasons overwrite earlier ones, except an ASCII spelling never
        # replaces an accented one.
        if current is None or current.isascii() or not name.isascii():
            names[pid] = name
    return names


def season_label(season: int) -> str:
    return f"{season - 1}–{str(season)[-2:]}"


def num(value, digits: int | None = None):
    """JSON-safe number: NaN becomes null, optional rounding."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if digits is None:
        return int(round(value))
    return round(float(value), digits)


def validate(df: pd.DataFrame) -> list[str]:
    notes: list[str] = []

    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        fail(f"Missing column(s): {', '.join(missing)}")

    for col in ["Season", "model", "Player", "pred_salary"]:
        blanks = df[col].isna().sum()
        if blanks:
            fail(f"{blanks} row(s) have a blank {col}")

    bad_models = sorted(set(df["model"]) - set(MODELS))
    if bad_models:
        fail(f"Unknown model value(s): {bad_models}. Expected {sorted(MODELS)}")

    seasons = sorted(int(s) for s in df["Season"].unique())
    no_cap = [s for s in seasons if s not in CAPS]
    if no_cap:
        fail(f"No salary cap for season(s) {no_cap}. Add them to CAPS in scripts/build_data.py")

    # Every player-season appears exactly once per model.
    counts = df.groupby(["Season", "Player", "model"]).size()
    dupes = counts[counts > 1]
    if len(dupes):
        sample = ", ".join(f"{p} ({s}, {m})" for (s, p, m) in dupes.index[:5])
        fail(f"{len(dupes)} duplicate player-season-model row(s), e.g. {sample}")
    per_player = df.groupby(["Season", "Player"])["model"].nunique()
    incomplete = per_player[per_player != len(MODELS)]
    if len(incomplete):
        sample = ", ".join(f"{p} ({s})" for (s, p) in incomplete.index[:5])
        fail(f"{len(incomplete)} player-season(s) are missing a model, e.g. {sample}")

    # Both rows of a player-season describe the same season.
    wide = df.pivot(index=["Season", "Player"], columns="model", values=SHARED)
    for col in SHARED:
        a, b = wide[(col, "market")], wide[(col, "production")]
        differ = ~((a == b) | (a.isna() & b.isna()))
        if differ.any():
            s, p = differ[differ].index[0]
            fail(f"{col} differs between the two model rows for {p} ({s})")

    # Residual is (Salary - pred_salary) / cap wherever Salary is known.
    has_salary = df["Salary"].notna()
    if (df.loc[~has_salary, "residual"].notna()).any():
        fail("Some rows have a residual but no Salary")
    if (df.loc[has_salary, "residual"].isna()).any():
        fail("Some rows have a Salary but no residual")
    known = df[has_salary]
    cap = known["Season"].map(CAPS)
    expected = (known["Salary"] - known["pred_salary"]) / cap
    error = (known["residual"] - expected).abs()
    if len(error) and error.max() > RESIDUAL_TOLERANCE:
        row = known.loc[error.idxmax()]
        fail(
            f"residual doesn't match (Salary - pred_salary) / cap for {row['Player']} "
            f"({row['Season']}, {row['model']}): got {row['residual']:.6f}, "
            f"expected {expected.loc[error.idxmax()]:.6f}"
        )
    sample = known.sample(min(5, len(known)), random_state=0)
    for _, r in sample.iterrows():
        notes.append(
            f"  spot-check {r['Player']} {r['Season']} {r['model']}: "
            f"({r['Salary']:,.0f} - {r['pred_salary']:,.0f}) / {CAPS[r['Season']]:,} "
            f"= {(r['Salary'] - r['pred_salary']) / CAPS[r['Season']]:+.4f}, CSV says {r['residual']:+.4f}"
        )
    notes.append(f"  residual check: {len(known)} rows, max error {error.max() if len(error) else 0:.2e}")

    low_games = (df["G"] < MIN_GAMES).sum()
    if low_games:
        notes.append(f"  warning: {low_games // 2} player-season(s) have fewer than {MIN_GAMES} games")

    per_season = df[df["model"] == "market"].groupby("Season")["Salary"].agg(lambda s: s.isna().sum())
    for season, n in per_season.items():
        total = int((df[(df["model"] == "market")]["Season"] == season).sum())
        if n == total:
            notes.append(f"  {season}: no actual salaries (predictions only)")
        elif n:
            notes.append(f"  {season}: {n} of {total} players have no salary and are left out of salary charts")

    return notes


def season_records(df: pd.DataFrame, season: int, model: str, names: dict[str, str]) -> list[dict]:
    cap = CAPS[season]
    rows = df[(df["Season"] == season) & (df["model"] == model)].copy()
    rows["surplus"] = rows["pred_salary"] - rows["Salary"]
    # Value rank: 1 = most underpaid relative to the model. Seasons without
    # salaries rank by predicted value instead.
    rows["surplus_rank"] = rows["surplus"].rank(ascending=False, method="min")
    rows["pred_rank"] = rows["pred_salary"].rank(ascending=False, method="min")
    rows = rows.sort_values("pred_salary", ascending=False)

    out = []
    for _, r in rows.iterrows():
        salary = r["Salary"]
        pid = player_id(r["Player"])
        out.append({
            "id": pid,
            "player": names[pid],
            "team": r["Team"],
            "pos": r["Pos"],
            "age": num(r["Age"]),
            "g": num(r["G"]),
            "mp": num(r["MP"], 1),
            "pts": num(r["PTS"], 1),
            "trb": num(r["TRB"], 1),
            "ast": num(r["AST"], 1),
            "salary": num(salary),
            "salary_pct": num(salary / cap, 5) if pd.notna(salary) else None,
            "pred": num(r["pred_salary"]),
            "pred_pct": num(r["pred_salary"] / cap, 5),
            "residual_pct": num(r["residual"], 5),
            "surplus": num(r["surplus"]),
            "surplus_pct": num(r["surplus"] / cap, 5) if pd.notna(salary) else None,
            "surplus_rank": num(r["surplus_rank"]),
            "pred_rank": num(r["pred_rank"]),
            "split": r["split"] if "split" in rows.columns and pd.notna(r.get("split")) else None,
        })
    return out


def build(csv_path: Path) -> None:
    print(f"Reading {csv_path}")
    df = pd.read_csv(csv_path)
    df["Season"] = df["Season"].astype(int)
    print(f"  {len(df)} rows, {df['Season'].nunique()} seasons")

    notes = validate(df)
    print("Validation passed")
    for n in notes:
        print(n)

    DATA_DIR.mkdir(exist_ok=True)
    for old in DATA_DIR.glob("*.json"):
        old.unlink()

    names = canonical_names(df)
    renamed = sum(1 for n in df["Player"].unique() if names[player_id(n)] != n)
    if renamed:
        print(f"  merged {renamed} spelling variant(s) of player names (accents)")

    sources = json.loads(SOURCES_FILE.read_text()) if SOURCES_FILE.exists() else {}
    season_info = []
    for season in sorted(df["Season"].unique()):
        for model in MODELS:
            records = season_records(df, season, model, names)
            path = DATA_DIR / f"{season}-{model}.json"
            path.write_text(json.dumps(records, separators=(",", ":"), ensure_ascii=False))
        s = df[(df["Season"] == season) & (df["model"] == "market")]
        splits = sorted(s["split"].dropna().unique().tolist()) if "split" in s else []
        season_info.append({
            "season": int(season),
            "label": season_label(int(season)),
            "cap": CAPS[season],
            "players": int(len(s)),
            "has_salary": bool(s["Salary"].notna().any()),
            "salary_source": sources.get(str(season)),
            "splits": splits,
        })

    teams = sorted(df["Team"].dropna().unique().tolist())
    manifest = {
        "generated": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"),
        "min_games": MIN_GAMES,
        "seasons": season_info,
        "models": [{"id": k, **v} for k, v in MODELS.items()],
        "teams": teams,
        "files": "data/{season}-{model}.json",
    }
    (DATA_DIR / "seasons.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"Wrote {len(season_info) * len(MODELS)} season files and data/seasons.json")


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    try:
        build(path)
    except BuildError as e:
        print(f"\nBuild stopped: {e}", file=sys.stderr)
        sys.exit(1)
