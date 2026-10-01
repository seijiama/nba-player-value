# NBA Player Value

What NBA players *should* earn based on their production, next to what they're actually paid, for 2015–16 through 2025–26.

Live site: https://seijiama.github.io/nba-player-value/

It's a static single-page site: plain HTML, CSS and JavaScript, with [Plotly.js](https://plotly.com/javascript/) loaded from its CDN. There's no build step for the page and no backend. The only build step is a Python script that turns the model output CSV into the JSON files the page reads.

## What's in the folder

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The site |
| `all-seasons-values.csv` | Source data: one row per player-season per model |
| `data/<season>-<model>.json` | One file per season and model, read by the site |
| `data/seasons.json` | Lists the seasons, models, salary caps and teams the site can show |
| `scripts/build_data.py` | Validates the CSV and writes everything in `data/` |
| `scripts/make_values_csv.py` | Reshapes the notebook's export into `all-seasons-values.csv` |

## Updating the data

You need Python 3.9+ and pandas (`pip install pandas`).

### 1. Get the CSV into the right shape

`build_data.py` reads `all-seasons-values.csv`. That file has one row per player-season **per model**, so every player-season appears twice:

| Column | Meaning |
|---|---|
| `Season` | Season-end year: `2025` is the 2024–25 season |
| `model` | `market` (age-aware) or `production` (age-blind) |
| `Player`, `Team`, `Pos`, `Age`, `G`, `MP`, `PTS`, `TRB`, `AST` | Player-season info, the same on both model rows |
| `Salary` | Actual salary in dollars. Leave it blank if it isn't known yet |
| `pred_salary` | The model's predicted salary in dollars |
| `residual` | `(Salary − pred_salary) / cap` for that season. Blank when `Salary` is blank |
| `split` | Optional: `train`, `test` or `projection` |

The notebook's export (`nba_model_predictions_with_2026.csv`) has both models side by side as shares of the cap. Convert it with:

```bash
python scripts/make_values_csv.py path/to/nba_model_predictions_with_2026.csv
```

### 2. Build the JSON files

```bash
python scripts/build_data.py
```

The script stops with a message and writes nothing if any of these checks fail:

- Every player-season has exactly one `market` row and one `production` row.
- Both rows of a player-season agree on team, age, stats and salary.
- Every season has a salary cap listed in `CAPS` at the top of the script.
- `residual` equals `(Salary − pred_salary) / cap` (to within $1–2K). It prints a few spot-checks so you can see the arithmetic.

It also merges spelling variants of the same name (e.g. "Nikola Jokic" in older seasons and "Nikola Jokić" in newer ones) so search finds one player.

### Adding salaries for a season that only has predictions

2025–26 came in with stats and predictions but no actual salaries. To add them, save a CSV with a player-name column and a salary column (a table copied from HoopsHype or Basketball-Reference works; `$` signs and commas are fine), then run:

```bash
python scripts/add_salaries.py salaries-2026.csv --season 2026 --source "HoopsHype"
python scripts/build_data.py
```

`add_salaries.py` only fills in `Salary` and recomputes `residual`. It never changes predictions. It lists any players it couldn't match by name; add those to `ALIASES` in the script and rerun with `--overwrite`. The `--source` text is saved in `salary-sources.json` and shown in the site's methodology section. If you regenerate `all-seasons-values.csv` with `make_values_csv.py`, run `add_salaries.py` again afterwards.

### Adding a new season

1. Add the season's cap to `CAPS` in `scripts/build_data.py`, e.g. `2027: 165_000_000,`.
2. Add the new rows to `all-seasons-values.csv` (or regenerate it with `make_values_csv.py`).
3. Run `python scripts/build_data.py`.
4. Commit `all-seasons-values.csv` and `data/`, then push. The site picks up new seasons from `data/seasons.json` automatically.

When actual salaries arrive for a projection season, add them with `add_salaries.py` and rebuild. The charts, team totals and surplus sorting switch on for that season automatically.

## Running it locally

The page loads its data with `fetch`, which browsers block for files opened straight from disk. Serve the folder instead:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Deploying

GitHub Pages serves the `main` branch from the repository root. Push to `main` and the site updates within a minute or two.

## Methodology in brief

- **Market value model.** Random forest on per-game stats, games, minutes and age. Predicts salary as a share of the cap. Test R² 0.71.
- **Production value model.** The same model without age. Test R² 0.57.
- **Data.** [Basketball-Reference](https://www.basketball-reference.com/) per-game stats. Salaries for 2015–16 to 2024–25 come with the training dataset; the source for any later season is listed in `salary-sources.json`. Only player-seasons with 55+ games are included.
- **Residual.** `(actual − predicted) / cap`. Positive means overpaid relative to the model.
- **In-sample caveat.** 80% of 2015–16 to 2024–25 rows trained the models, so historical residuals look slightly better than they would on new data. 2025–26 was never used in training, so it's fully out-of-sample.

Built by Seiji Ma.
