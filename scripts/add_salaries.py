#!/usr/bin/env python3
"""Add actual salaries for one season to all-seasons-values.csv.

Use this when a season's stats and predictions are already in the CSV but its
salaries aren't (2025-26 at first). It only fills in `Salary` and recomputes
`residual = (Salary - pred_salary) / cap`. Predictions are never touched.

Usage (from the repo root):

    python scripts/add_salaries.py salaries-2026.csv --season 2026 --source "HoopsHype"
    python scripts/build_data.py

The salary file needs a player-name column and a salary column. Headers are
matched loosely ("Player", "Name", "Salary", "2025-26", ...) and values like
"$59,606,817" are fine. A table copied from HoopsHype or Basketball-Reference
and saved as CSV works.

Names are matched ignoring accents, punctuation and suffixes (Jr., III), plus
a short alias list below. Players the script can't match are listed so you can
add an alias and rerun. Players without a salary stay blank: the site leaves
them out of salary charts and lists them last when sorting by surplus.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import CAPS, DEFAULT_CSV, ROOT, player_id  # noqa: E402

SOURCES_FILE = ROOT / "salary-sources.json"

# Same player, different spelling between Basketball-Reference and salary sites.
# Keys and values are match keys (see key() below).
ALIASES = {
    "nic-claxton": "nicolas-claxton",
    "herb-jones": "herbert-jones",
    "cam-johnson": "cameron-johnson",
    "gg-jackson": "gregory-jackson",
    "alex-sarr": "alexandre-sarr",
    "moe-wagner": "moritz-wagner",
    "kj-martin": "kenyon-martin",
    "dennis-schroeder": "dennis-schroder",
    "bub-carrington": "carlton-carrington",
    "nikola-djurisic": "nikola-durisic",
    "egor-demin": "egor-dyomin",
}


def key(name: str) -> str:
    # Periods are dropped first so "T.J. McConnell" and "TJ McConnell" match.
    k = player_id(str(name).replace(".", ""))
    k = re.sub(r"-(jr|sr|ii|iii|iv|v)$", "", k)
    return ALIASES.get(k, k)


ABBREVIATED = re.compile(r"^([A-Za-z])\.\s+(.+)$")  # "S. Gilgeous-Alexander"


def initial_keys(name: str) -> set[str]:
    """First initial + surname keys a full name could be abbreviated to."""
    parts = str(name).split()
    out = set()
    if len(parts) > 1:
        out.add(f"{parts[0][0].lower()}|{key(' '.join(parts[1:]))}")
    resolved = key(name)  # an alias can change the first name (Bub -> Carlton)
    if "-" in resolved:
        first, rest = resolved.split("-", 1)
        out.add(f"{first[0]}|{rest}")
    return out


def find_col(df: pd.DataFrame, words: list[str], what: str) -> str:
    for w in words:
        for c in df.columns:
            if w in str(c).lower():
                return c
    sys.exit(f"Couldn't find a {what} column in the salary file. Columns: {list(df.columns)}")


def money(v) -> float | None:
    if pd.isna(v):
        return None
    s = re.sub(r"[^0-9.]", "", str(v))
    return float(s) if s else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("salaries", type=Path, help="CSV with player names and salaries")
    ap.add_argument("--season", type=int, default=2026, help="season-end year (2026 = 2025-26)")
    ap.add_argument("--source", required=True, help='where the salaries came from, shown on the site, e.g. "HoopsHype"')
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="the values CSV to update")
    ap.add_argument("--overwrite", action="store_true", help="replace salaries already in the CSV for this season")
    args = ap.parse_args()

    if args.season not in CAPS:
        sys.exit(f"No salary cap for {args.season}. Add it to CAPS in scripts/build_data.py first.")
    cap = CAPS[args.season]

    sal = pd.read_csv(args.salaries)
    pcol = find_col(sal, ["player", "name"], "player name")
    scol = find_col(sal, ["salary", f"{args.season - 1}-{str(args.season)[-2:]}", f"{args.season - 1}/{str(args.season)[-2:]}", "amount", "cash"], "salary")
    sal = pd.DataFrame({"name": sal[pcol], "salary": sal[scol].map(money)}).dropna()
    sal["key"] = sal["name"].map(key)
    dupes = sal[sal["key"].duplicated(keep=False)]
    if len(dupes):
        print(f"  {dupes['key'].nunique()} name(s) appear more than once; keeping the larger salary: "
              + ", ".join(sorted(dupes["name"].unique())[:8]))
    lookup = sal.groupby("key")["salary"].max().to_dict()

    df = pd.read_csv(args.csv)
    rows = df["Season"] == args.season
    if not rows.any():
        sys.exit(f"No {args.season} rows in {args.csv}")
    if df.loc[rows, "Salary"].notna().any() and not args.overwrite:
        sys.exit(f"{args.season} already has salaries. Pass --overwrite to replace them.")

    keys = df.loc[rows, "Player"].map(key)
    found = keys.map(lookup)

    # Some sites shorten long names to an initial ("K. Towns"). Match those only
    # when exactly one salary entry and exactly one player in the season fit.
    abbr: dict[str, list[float]] = {}
    for name, salary in zip(sal["name"], sal["salary"]):
        m = ABBREVIATED.match(str(name).strip())
        if m:
            abbr.setdefault(f"{m.group(1).lower()}|{key(m.group(2))}", []).append(salary)
    season_players = df.loc[rows, "Player"].unique()
    fits: dict[str, list[str]] = {}
    for p in season_players:
        for ik in initial_keys(p):
            fits.setdefault(ik, []).append(p)
    by_initial = {}
    for p in season_players:
        if pd.notna(lookup.get(key(p))):
            continue
        hits = [ik for ik in initial_keys(p) if len(abbr.get(ik, [])) == 1 and fits.get(ik) == [p]]
        if hits:
            by_initial[p] = abbr[hits[0]][0]
    if by_initial:
        print(f"  matched {len(by_initial)} abbreviated name(s) by first initial: " + ", ".join(sorted(by_initial)))
        found = found.fillna(df.loc[rows, "Player"].map(by_initial))
    df.loc[rows, "Salary"] = found.round()
    df.loc[rows, "residual"] = ((found.round() - df.loc[rows, "pred_salary"]) / cap).round(6)
    df.to_csv(args.csv, index=False)

    players = df.loc[rows, "Player"]
    missing = sorted(set(players[found.isna()]))
    print(f"Matched {players[found.notna()].nunique()} of {players.nunique()} {args.season} players to a salary")
    if missing:
        print(f"  no salary found for {len(missing)}: {', '.join(missing)}")
        print("  If any of these are spelling differences, add them to ALIASES in this script and rerun with --overwrite.")

    sources = json.loads(SOURCES_FILE.read_text()) if SOURCES_FILE.exists() else {}
    sources[str(args.season)] = args.source
    SOURCES_FILE.write_text(json.dumps(sources, indent=2) + "\n")
    print(f"Updated {args.csv.name} and {SOURCES_FILE.name}. Now run: python scripts/build_data.py")


if __name__ == "__main__":
    main()
