/* NBA Player Value — app logic. Plain JS, no build step. */
(() => {
  "use strict";

  // ---------- Constants ----------

  const TEAMS = {
    ATL: ["Atlanta Hawks", "#e03a3e"],
    BOS: ["Boston Celtics", "#2fa760"],
    BKN: ["Brooklyn Nets", "#c9ced3"],
    CHA: ["Charlotte Hornets", "#2aa5b5"],
    CHI: ["Chicago Bulls", "#ce1141"],
    CLE: ["Cleveland Cavaliers", "#b4425f"],
    DAL: ["Dallas Mavericks", "#2f86d6"],
    DEN: ["Denver Nuggets", "#fec524"],
    DET: ["Detroit Pistons", "#e5455a"],
    GSW: ["Golden State Warriors", "#ffc72c"],
    HOU: ["Houston Rockets", "#e8304b"],
    IND: ["Indiana Pacers", "#fdbb30"],
    LAC: ["LA Clippers", "#4a82e6"],
    LAL: ["Los Angeles Lakers", "#9466d6"],
    MEM: ["Memphis Grizzlies", "#86a3cf"],
    MIA: ["Miami Heat", "#f26b5b"],
    MIL: ["Milwaukee Bucks", "#4c9a5f"],
    MIN: ["Minnesota Timberwolves", "#78be20"],
    NOP: ["New Orleans Pelicans", "#c8a86a"],
    NYK: ["New York Knicks", "#f58426"],
    OKC: ["Oklahoma City Thunder", "#2c9be0"],
    ORL: ["Orlando Magic", "#1e8fe3"],
    PHI: ["Philadelphia 76ers", "#3a78dc"],
    PHX: ["Phoenix Suns", "#e56020"],
    POR: ["Portland Trail Blazers", "#e8484c"],
    SAC: ["Sacramento Kings", "#9a77d4"],
    SAS: ["San Antonio Spurs", "#b9c4cb"],
    TOR: ["Toronto Raptors", "#d62550"],
    UTA: ["Utah Jazz", "#f2c14e"],
    WAS: ["Washington Wizards", "#4f7ccc"],
  };
  const TRADED_COLOR = "#7c8894";
  const teamName = (code) => (TEAMS[code] ? TEAMS[code][0] : /^\dTM$/.test(code) ? `${code[0]} teams (traded)` : code);
  const teamColor = (code) => (TEAMS[code] ? TEAMS[code][1] : TRADED_COLOR);
  const isTraded = (code) => /^\dTM$/.test(code);

  // Ordinal ramp for seasons (one hue, dark-surface steps 550 -> 100).
  // Newest season is lightest; colour follows the season, never its rank in the selection.
  const SEASON_RAMP = ["#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4", "#b7d3f6", "#cde2fb"];

  const C = {
    text: "#e8edf2", text2: "#a3b1bf", muted: "#74838f",
    line: "#243140", lineStrong: "#33445a", panel2: "#1a2430", bg: "#141c25",
    accent: "#e8a54b", under: "#3987e5", over: "#e66767",
  };
  const FONT = '"Archivo", system-ui, -apple-system, "Segoe UI", sans-serif';
  const BOARD_ROWS = 12;

  // ---------- State ----------

  const state = {
    manifest: null,
    data: {},            // data[season][model] = records
    players: new Map(),  // id -> { id, name, seasons: [..] }
    season: null,
    model: "market",
    team: "all",
    sortDir: "desc",
    showAll: false,
    scatterSeasons: new Set(),
    unit: "usd",
    player: null,
    cardSeason: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    seasonSelect: $("#season-select"),
    teamSelect: $("#team-select"),
    modelToggle: $("#model-toggle"),
    sortToggle: $("#sort-toggle"),
    unitToggle: $("#unit-toggle"),
    chips: $("#season-chips"),
    search: $("#player-search"),
    results: $("#search-results"),
    card: $("#player-card"),
    boardTitle: $("#board-title"),
    boardBody: $("#board-table tbody"),
    boardMore: $("#board-more"),
    pay: $("#scatter-pay"),
    age: $("#scatter-age"),
    bars: $("#team-bars"),
    teamNote: $("#team-note"),
    payNote: $("#scatter-pay-note"),
    ageNote: $("#scatter-age-note"),
    footerMeta: $("#footer-meta"),
    seasonSpan: $("#season-span"),
  };

  // ---------- Helpers ----------

  const seasonInfo = (s) => state.manifest.seasons.find((x) => x.season === s);
  const seasonLabel = (s) => seasonInfo(s)?.label ?? String(s);
  const hasSalary = (s) => !!seasonInfo(s)?.has_salary;
  const modelInfo = (m) => state.manifest.models.find((x) => x.id === m);
  const recordsFor = (season, model = state.model) => state.data[season]?.[model] ?? [];
  const byTeam = (rows) => (state.team === "all" ? rows : rows.filter((r) => r.team === state.team));

  function money(v, { signed = false } = {}) {
    if (v == null || Number.isNaN(v)) return "—";
    const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
    const a = Math.abs(v);
    const body = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${Math.round(a / 1e3)}K`;
    return sign + body;
  }
  function pct(v, { signed = false } = {}) {
    if (v == null || Number.isNaN(v)) return "—";
    const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
    return `${sign}${Math.abs(v * 100).toFixed(1)}%`;
  }
  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  function normalize(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  }

  function seasonColor(season) {
    const seasons = state.manifest.seasons.filter((s) => s.has_salary).map((s) => s.season);
    const i = seasons.indexOf(season);
    if (i < 0) return C.text2;
    const t = seasons.length === 1 ? 1 : i / (seasons.length - 1);
    return interpolateRamp(SEASON_RAMP, t);
  }
  function interpolateRamp(stops, t) {
    const x = t * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    const f = x - i;
    const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
    const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Small deterministic jitter so players of the same age don't stack into one column.
  function jitter(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 1000) / 1000 - 0.5) * 0.5;
  }

  function setRadio(group, attr, value) {
    group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset[attr] === value)));
  }

  function defaultUnit() {
    return state.scatterSeasons.size > 1 ? "pct" : "usd";
  }

  // ---------- Data loading ----------

  async function load() {
    const res = await fetch("data/seasons.json");
    if (!res.ok) throw new Error(`Couldn't load data/seasons.json (${res.status})`);
    state.manifest = await res.json();

    const jobs = [];
    for (const s of state.manifest.seasons) {
      state.data[s.season] = {};
      for (const m of state.manifest.models) {
        const path = state.manifest.files.replace("{season}", s.season).replace("{model}", m.id);
        jobs.push(fetch(path).then((r) => {
          if (!r.ok) throw new Error(`Couldn't load ${path} (${r.status})`);
          return r.json();
        }).then((rows) => { state.data[s.season][m.id] = rows; }));
      }
    }
    await Promise.all(jobs);

    for (const s of state.manifest.seasons) {
      for (const r of recordsFor(s.season, "market")) {
        if (!state.players.has(r.id)) state.players.set(r.id, { id: r.id, name: r.player, key: normalize(r.player), seasons: [] });
        state.players.get(r.id).seasons.push(s.season);
      }
    }
  }

  // ---------- URL hash (shareable state) ----------

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const season = Number(p.get("season"));
    if (seasonInfo(season)) state.season = season;
    if (p.get("model") && modelInfo(p.get("model"))) state.model = p.get("model");
    if (p.get("team") && (p.get("team") === "all" || state.manifest.teams.includes(p.get("team")))) state.team = p.get("team");
    if (p.get("player") && state.players.has(p.get("player"))) {
      state.player = p.get("player");
      const cs = Number(p.get("card"));
      state.cardSeason = state.players.get(state.player).seasons.includes(cs) ? cs : null;
    }
  }

  function writeHash() {
    const p = new URLSearchParams({ season: state.season, model: state.model, team: state.team });
    if (state.player) { p.set("player", state.player); p.set("card", state.cardSeason); }
    history.replaceState(null, "", `#${p}`);
  }

  // ---------- Controls ----------

  function buildControls() {
    const seasons = state.manifest.seasons;
    el.seasonSpan.textContent = `${seasons[0].label} to ${seasons[seasons.length - 1].label}`;

    for (const s of [...seasons].reverse()) {
      const o = document.createElement("option");
      o.value = s.season;
      o.textContent = s.has_salary ? s.label : `${s.label} (projection)`;
      el.seasonSelect.append(o);
    }

    const teams = state.manifest.teams.filter((t) => !isTraded(t)).sort((a, b) => teamName(a).localeCompare(teamName(b)));
    for (const t of teams) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = teamName(t);
      el.teamSelect.append(o);
    }

    for (const s of seasons) {
      const label = document.createElement("label");
      label.className = "chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = s.season;
      input.disabled = !s.has_salary;
      if (!s.has_salary) label.title = "No salaries for this season yet";
      const span = document.createElement("span");
      const sw = document.createElement("i");
      sw.className = "swatch";
      sw.style.setProperty("--sw", seasonColor(s.season));
      span.append(sw, document.createTextNode(s.label));
      label.append(input, span);
      el.chips.append(label);
    }
    const actions = document.createElement("span");
    actions.className = "chip-action";
    const all = document.createElement("button");
    all.type = "button"; all.textContent = "All seasons"; all.dataset.action = "all";
    const one = document.createElement("button");
    one.type = "button"; one.textContent = "Just the selected season"; one.dataset.action = "one";
    actions.append(all, one);
    el.chips.append(actions);

    const latest = seasons[seasons.length - 1];
    el.footerMeta.textContent = `Data through ${latest.label}. Updated ${state.manifest.generated}.`;
  }

  function syncControls() {
    el.seasonSelect.value = state.season;
    el.teamSelect.value = state.team;
    setRadio(el.modelToggle, "model", state.model);
    setRadio(el.sortToggle, "dir", state.sortDir);
    setRadio(el.unitToggle, "unit", state.unit);
    el.chips.classList.toggle("by-season", state.scatterSeasons.size > 1);
    el.chips.querySelectorAll("input").forEach((i) => { i.checked = state.scatterSeasons.has(Number(i.value)); });
    el.sortToggle.hidden = !hasSalary(state.season);
  }

  function setSeason(season) {
    state.season = season;
    state.scatterSeasons = hasSalary(season) ? new Set([season]) : new Set();
    state.unit = defaultUnit();
    state.showAll = false;
    if (state.player && state.players.get(state.player).seasons.includes(season)) state.cardSeason = season;
    renderAll();
  }

  function wireEvents() {
    el.seasonSelect.addEventListener("change", () => setSeason(Number(el.seasonSelect.value)));

    el.teamSelect.addEventListener("change", () => {
      state.team = el.teamSelect.value;
      state.showAll = false;
      renderAll();
    });

    el.modelToggle.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-model]");
      if (!b || b.dataset.model === state.model) return;
      state.model = b.dataset.model;
      renderAll();
    });

    el.sortToggle.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-dir]");
      if (!b) return;
      state.sortDir = b.dataset.dir;
      state.showAll = false;
      syncControls();
      renderBoard();
    });

    el.unitToggle.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-unit]");
      if (!b) return;
      state.unit = b.dataset.unit;
      syncControls();
      renderScatters();
    });

    el.chips.addEventListener("change", (e) => {
      const s = Number(e.target.value);
      if (e.target.checked) state.scatterSeasons.add(s);
      else state.scatterSeasons.delete(s);
      state.unit = defaultUnit();
      syncControls();
      renderScatters();
    });

    el.chips.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-action]");
      if (!b) return;
      const withSalary = state.manifest.seasons.filter((s) => s.has_salary).map((s) => s.season);
      state.scatterSeasons = b.dataset.action === "all"
        ? new Set(withSalary)
        : new Set(hasSalary(state.season) ? [state.season] : []);
      state.unit = defaultUnit();
      syncControls();
      renderScatters();
    });

    el.boardMore.addEventListener("click", () => {
      state.showAll = !state.showAll;
      renderBoard();
    });

    el.boardBody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) openPlayer(tr.dataset.id, state.season, true);
    });
    el.boardBody.addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPlayer(tr.dataset.id, state.season, true); }
    });

    el.card.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-season]");
      if (!b) return;
      state.cardSeason = Number(b.dataset.season);
      renderCard();
      writeHash();
    });

    wireSearch();

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        [el.pay, el.age, el.bars].forEach((p) => { if (p.data) Plotly.Plots.resize(p); });
      }, 150);
    });
  }

  // ---------- Search (combobox) ----------

  function wireSearch() {
    let matches = [];
    let active = -1;

    const close = () => {
      el.results.hidden = true;
      el.search.setAttribute("aria-expanded", "false");
      el.search.removeAttribute("aria-activedescendant");
      active = -1;
    };

    const highlight = (i) => {
      active = i;
      el.results.querySelectorAll("li[role=option]").forEach((li, k) => li.setAttribute("aria-selected", String(k === i)));
      if (i >= 0) {
        el.search.setAttribute("aria-activedescendant", `sr-${i}`);
        el.results.children[i]?.scrollIntoView({ block: "nearest" });
      }
    };

    const choose = (i) => {
      const p = matches[i];
      if (!p) return;
      el.search.value = p.name;
      close();
      const season = p.seasons.includes(state.season) ? state.season : p.seasons[p.seasons.length - 1];
      openPlayer(p.id, season, false);
    };

    const update = () => {
      const q = normalize(el.search.value.trim());
      el.results.replaceChildren();
      if (!q) { close(); return; }
      const words = q.split(/\s+/);
      matches = [...state.players.values()]
        .filter((p) => words.every((w) => p.key.split(" ").some((part) => part.startsWith(w)) || p.key.includes(w)))
        .sort((a, b) => {
          const as = a.key.startsWith(q) ? 0 : 1, bs = b.key.startsWith(q) ? 0 : 1;
          return as - bs || b.seasons[b.seasons.length - 1] - a.seasons[a.seasons.length - 1] || a.name.localeCompare(b.name);
        })
        .slice(0, 8);

      if (!matches.length) {
        const li = document.createElement("li");
        li.className = "sr-empty";
        li.textContent = "No qualifying player by that name. Players need 55+ games in a season.";
        el.results.append(li);
      }
      matches.forEach((p, i) => {
        const li = document.createElement("li");
        li.id = `sr-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        const name = document.createElement("span");
        name.textContent = p.name;
        const meta = document.createElement("span");
        meta.className = "sr-meta";
        const first = p.seasons[0], last = p.seasons[p.seasons.length - 1];
        const latestRec = recordsFor(last, "market").find((r) => r.id === p.id);
        meta.textContent = `${latestRec ? latestRec.team : ""}  ${first === last ? seasonLabel(first) : `${seasonLabel(first)} to ${seasonLabel(last)}`}`;
        li.append(name, meta);
        li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
        el.results.append(li);
      });
      el.results.hidden = false;
      el.search.setAttribute("aria-expanded", "true");
      highlight(matches.length ? 0 : -1);
    };

    el.search.addEventListener("input", update);
    el.search.addEventListener("focus", () => { if (el.search.value.trim()) update(); });
    el.search.addEventListener("blur", () => setTimeout(close, 100));
    el.search.addEventListener("keydown", (e) => {
      if (el.results.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(active + 1, matches.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { close(); }
    });
  }

  function openPlayer(id, season, scroll) {
    if (!state.players.has(id)) return;
    state.player = id;
    state.cardSeason = state.players.get(id).seasons.includes(season) ? season : state.players.get(id).seasons.at(-1);
    renderCard();
    renderBoard();
    writeHash();
    if (scroll) el.card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Player card ----------

  function renderCard() {
    const card = el.card;
    card.replaceChildren();
    const player = state.players.get(state.player);
    if (!player) {
      const p = document.createElement("p");
      p.className = "card-empty";
      p.textContent = "Search for a player above, or pick one from the table.";
      card.append(p);
      return;
    }
    const season = state.cardSeason;
    const rec = {
      market: recordsFor(season, "market").find((r) => r.id === player.id),
      production: recordsFor(season, "production").find((r) => r.id === player.id),
    };
    const base = rec.market;
    const info = seasonInfo(season);

    const top = document.createElement("div");
    top.className = "card-top";
    top.style.setProperty("--team-color", teamColor(base.team));
    const h = document.createElement("h3");
    h.className = "card-name";
    h.textContent = player.name;
    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = `${teamName(base.team)}, ${base.pos}, age ${base.age}. ${info.label} season.`;
    top.append(h, meta);

    if (player.seasons.length > 1) {
      const chips = document.createElement("div");
      chips.className = "card-seasons";
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Seasons for this player");
      for (const s of player.seasons) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.season = s;
        b.textContent = seasonLabel(s);
        b.setAttribute("aria-pressed", String(s === season));
        chips.append(b);
      }
      top.append(chips);
    }

    const tags = document.createElement("div");
    tags.className = "card-tags";
    const addTag = (text) => {
      const t = document.createElement("span");
      t.className = "card-tag";
      t.textContent = text;
      tags.append(t);
    };
    if (!player.seasons.includes(state.season)) {
      addTag(`Not in ${seasonLabel(state.season)}: under 55 games or not in the league.`);
    }
    const splitText = {
      train: "Training row: the models saw this season (footnote b)",
      test: "Held-out test row: the models never saw this season",
      projection: `${info.label} projection: no actual salary yet`,
    }[base.split];
    if (splitText) addTag(splitText);
    if (tags.children.length) top.append(tags);

    const stats = document.createElement("div");
    stats.className = "statline";
    for (const [v, label] of [[base.g, "Games"], [base.mp, "Minutes"], [base.pts, "Points"], [base.trb, "Rebounds"], [base.ast, "Assists"]]) {
      const d = document.createElement("div");
      const sv = document.createElement("span");
      sv.className = "stat-value";
      sv.textContent = typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : v;
      const sl = document.createElement("span");
      sl.className = "stat-label";
      sl.textContent = label === "Games" ? "Games" : `${label} / game`;
      d.append(sv, sl);
      stats.append(d);
    }

    const moneyBox = document.createElement("div");
    moneyBox.className = "money";

    const actual = document.createElement("div");
    actual.className = "money-actual";
    const al = document.createElement("span");
    al.className = "label";
    al.textContent = "Actual salary";
    const av = document.createElement("span");
    av.className = "value";
    if (base.salary != null) {
      av.textContent = money(base.salary);
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = `${pct(base.salary_pct)} of cap`;
      av.append(sub);
    } else {
      av.textContent = "Not available yet";
    }
    actual.append(al, av);

    const pair = document.createElement("div");
    pair.className = "model-pair";
    for (const m of state.manifest.models) {
      const r = rec[m.id];
      const box = document.createElement("section");
      box.className = "model-box" + (m.id === state.model ? " is-active" : "");
      box.setAttribute("aria-label", `${m.label} model`);
      const h4 = document.createElement("h4");
      h4.textContent = `${m.label} predicts`;
      const pred = document.createElement("span");
      pred.className = "pred";
      pred.textContent = money(r.pred);
      const dl = document.createElement("dl");
      const add = (k, v, cls) => {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        if (cls) dd.className = cls;
        dl.append(dt, dd);
      };
      add("Share of cap", pct(r.pred_pct));
      if (r.salary != null) {
        add("Surplus", money(r.surplus, { signed: true }), r.surplus >= 0 ? "is-under" : "is-over");
        add("Value rank", `${ordinal(r.surplus_rank)} of ${info.players}`);
      } else {
        add("Predicted-value rank", `${ordinal(r.pred_rank)} of ${info.players}`);
      }
      box.append(h4, pred, dl);
      pair.append(box);
    }

    const disc = document.createElement("div");
    disc.className = "discount";
    const dl2 = document.createElement("span");
    dl2.className = "label";
    dl2.textContent = "CBA discount";
    const gap = rec.production.pred - rec.market.pred;
    const dv = document.createElement("span");
    dv.className = "value";
    dv.textContent = money(gap, { signed: true });
    const dp = document.createElement("p");
    dp.textContent = gap >= 0
      ? "How much more the age-blind production model values him than the market model. The league's pay rules (rookie scale, max tiers by service time) hold his price down by about this much."
      : "The market model values him above his on-court production alone, usually because veterans' pay rises with years of service.";
    disc.append(dl2, dv, dp);

    moneyBox.append(actual, pair, disc);
    card.append(top, stats, moneyBox);
  }

  // ---------- Leaderboard ----------

  function renderBoard() {
    const season = state.season;
    const salary = hasSalary(season);
    let rows = byTeam(recordsFor(season));
    const scope = state.team === "all" ? "" : `, ${teamName(state.team)}`;

    if (salary) {
      rows = [...rows].sort((a, b) => (state.sortDir === "desc" ? b.surplus - a.surplus : a.surplus - b.surplus));
      el.boardTitle.textContent = `${state.sortDir === "desc" ? "Best value" : "Most overpaid"}, ${seasonLabel(season)}${scope}`;
    } else {
      rows = [...rows].sort((a, b) => b.pred - a.pred);
      el.boardTitle.textContent = `Highest predicted value, ${seasonLabel(season)}${scope}`;
    }

    const shown = state.showAll ? rows : rows.slice(0, BOARD_ROWS);
    const frag = document.createDocumentFragment();
    for (const r of shown) {
      const tr = document.createElement("tr");
      tr.dataset.id = r.id;
      tr.tabIndex = 0;
      if (r.id === state.player) tr.className = "is-current";
      const cells = [
        [salary ? r.surplus_rank : r.pred_rank, "num rank"],
        [r.player, ""],
        [r.team, ""],
        [r.age, "num"],
        [money(r.salary), "num col-salary"],
        [money(r.pred), "num"],
        [salary ? money(r.surplus, { signed: true }) : "—", "num col-salary" + (salary ? (r.surplus >= 0 ? " is-under" : " is-over") : "")],
      ];
      for (const [v, cls] of cells) {
        const td = document.createElement("td");
        td.textContent = v;
        if (cls) td.className = cls;
        tr.append(td);
      }
      frag.append(tr);
    }
    el.boardBody.replaceChildren(frag);
    el.boardBody.closest("table").classList.toggle("no-salary", !salary);

    el.boardMore.hidden = rows.length <= BOARD_ROWS;
    el.boardMore.textContent = state.showAll ? "Show fewer" : `Show all ${rows.length} players`;
  }

  // ---------- Plotly shared layout ----------

  function baseLayout(extra = {}) {
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: FONT, color: C.text2, size: 13 },
      margin: { l: 64, r: 16, t: 12, b: 56 },
      hovermode: "closest",
      hoverdistance: 24,
      dragmode: "zoom",
      hoverlabel: { bgcolor: C.panel2, bordercolor: C.lineStrong, font: { family: FONT, color: C.text, size: 13 }, align: "left" },
      legend: {
        orientation: "h", x: 0, xanchor: "left", y: -0.16, yanchor: "top",
        font: { size: 12, color: C.text2 }, itemclick: "toggle", itemdoubleclick: "toggleothers",
        bgcolor: "rgba(0,0,0,0)",
      },
      ...extra,
    };
  }
  function axis(title, extra = {}) {
    return {
      title: { text: title, font: { size: 13, color: C.text2 }, standoff: 10 },
      gridcolor: C.line, linecolor: C.lineStrong, zerolinecolor: C.lineStrong, zerolinewidth: 1,
      tickfont: { color: C.muted, size: 12 }, automargin: true,
      ...extra,
    };
  }
  const plotConfig = {
    responsive: true,
    scrollZoom: true,
    displaylogo: false,
    doubleClick: "reset+autosize",
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
    toImageButtonOptions: { format: "png", filename: "nba-player-value", scale: 2 },
  };

  function showEmpty(plotEl, message) {
    if (plotEl.data) Plotly.purge(plotEl);
    plotEl._wired = false; // purge drops Plotly's event listeners
    plotEl.replaceChildren();
    const d = document.createElement("div");
    d.className = "plot-empty";
    d.textContent = message;
    plotEl.append(d);
  }

  function draw(plotEl, traces, layout) {
    if (!plotEl.data) plotEl.replaceChildren();
    Plotly.react(plotEl, traces, layout, plotConfig);
    if (!plotEl._wired) {
      plotEl._wired = true;
      plotEl.on("plotly_click", (ev) => {
        const pt = ev.points && ev.points[0];
        if (pt && Array.isArray(pt.customdata)) openPlayer(pt.customdata[0], pt.customdata[1], true);
      });
    }
  }

  // ---------- Scatters ----------

  function scatterRows() {
    const out = [];
    for (const s of [...state.scatterSeasons].sort()) {
      for (const r of byTeam(recordsFor(s))) if (r.salary != null) out.push({ ...r, season: s });
    }
    return out;
  }

  function groupRows(rows) {
    const bySeason = state.scatterSeasons.size > 1;
    const groups = new Map();
    for (const r of rows) {
      const key = bySeason ? r.season : r.team;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const keys = [...groups.keys()].sort((a, b) => (bySeason ? a - b : String(a).localeCompare(String(b))));
    return keys.map((k) => ({
      key: k,
      name: bySeason ? seasonLabel(k) : k,
      color: bySeason ? seasonColor(k) : teamColor(k),
      rows: groups.get(k),
    }));
  }

  function hoverText(r) {
    const surplusCls = r.surplus >= 0 ? "underpaid" : "overpaid";
    return [
      `<b>${escapeHtml(r.player)}</b>  ${escapeHtml(r.team)}, ${seasonLabel(r.season)}`,
      `Age ${r.age}, ${r.pts.toFixed(1)} pts, ${r.trb.toFixed(1)} reb, ${r.ast.toFixed(1)} ast`,
      `Actual <b>${money(r.salary)}</b> (${pct(r.salary_pct)} of cap)`,
      `Predicted <b>${money(r.pred)}</b> (${pct(r.pred_pct)})`,
      `Surplus <b>${money(r.surplus, { signed: true })}</b> ${surplusCls}`,
    ].join("<br>");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderScatters() {
    const rows = scatterRows();
    const usd = state.unit === "usd";
    const model = modelInfo(state.model);
    const teamScope = state.team === "all" ? "" : ` ${teamName(state.team)} only.`;

    if (!rows.length) {
      const msg = state.scatterSeasons.size === 0
        ? (hasSalary(state.season)
            ? "Pick at least one season above to plot."
            : `${seasonLabel(state.season)} has no salary data yet, so there's nothing to compare predictions against. Pick earlier seasons above.`)
        : `No qualifying ${teamName(state.team)} players in the selected seasons.`;
      showEmpty(el.pay, msg);
      showEmpty(el.age, msg);
      return;
    }

    const groups = groupRows(rows);
    const xVal = (r) => (usd ? r.pred / 1e6 : r.pred_pct * 100);
    const yVal = (r) => (usd ? r.salary / 1e6 : r.salary_pct * 100);
    const unitWord = usd ? "$M" : "% of cap";
    // d3 currency format puts the minus sign before the $ (−$5M, not $−5M)
    const fmtTick = usd ? { tickformat: "$,~f", ticksuffix: "M" } : { tickformat: ",~f", ticksuffix: "%" };

    // Actual vs predicted
    const max = Math.max(...rows.map((r) => Math.max(xVal(r), yVal(r)))) * 1.04;
    // Many seasons at once means thousands of dots: shrink them so the overlap stays readable.
    const many = state.scatterSeasons.size > 3;
    const marker = (color) => ({ color, size: many ? 7 : 9, opacity: many ? 0.8 : 0.9, line: { color: C.bg, width: many ? 1 : 1.5 } });
    const payTraces = [{
      x: [0, max], y: [0, max], mode: "lines", name: "Paid exactly as predicted",
      line: { color: C.muted, width: 1.5 }, hoverinfo: "skip", showlegend: false,
    }];
    for (const g of groups) {
      payTraces.push({
        type: "scatter",
        mode: "markers",
        name: g.name,
        x: g.rows.map(xVal),
        y: g.rows.map(yVal),
        customdata: g.rows.map((r) => [r.id, r.season]),
        text: g.rows.map(hoverText),
        hovertemplate: "%{text}<extra></extra>",
        marker: marker(g.color),
      });
    }
    const corner = (text, x, y, xa, ya) => ({ text, x, y, xref: "paper", yref: "paper", xanchor: xa, yanchor: ya, showarrow: false, font: { size: 12, color: C.muted } });
    draw(el.pay, payTraces, baseLayout({
      xaxis: axis(`${model.label} prediction (${unitWord})`, { rangemode: "tozero", ...fmtTick }),
      yaxis: axis(`Actual salary (${unitWord})`, { rangemode: "tozero", ...fmtTick }),
      annotations: [corner("Overpaid", 0.01, 0.99, "left", "top"), corner("Underpaid", 0.99, 0.02, "right", "bottom")],
      showlegend: true,
    }));

    // Residual vs age
    const resVal = (r) => (usd ? (r.salary - r.pred) / 1e6 : r.residual_pct * 100);
    const ageTraces = groups.map((g) => ({
      type: "scatter",
      mode: "markers",
      name: g.name,
      x: g.rows.map((r) => r.age + jitter(r.id + r.season)),
      y: g.rows.map(resVal),
      customdata: g.rows.map((r) => [r.id, r.season]),
      text: g.rows.map(hoverText),
      hovertemplate: "%{text}<extra></extra>",
      marker: marker(g.color),
    }));
    draw(el.age, ageTraces, baseLayout({
      xaxis: axis("Age", { dtick: 2, zeroline: false }),
      yaxis: axis(`Actual − predicted (${unitWord})`, { zeroline: true, zerolinecolor: C.text2, ...fmtTick }),
      annotations: [corner("Paid more than predicted", 0.01, 0.99, "left", "top"), corner("Paid less than predicted", 0.01, 0.01, "left", "bottom")],
      showlegend: true,
    }));

    const colorNote = state.scatterSeasons.size > 1
      ? "Colored by season, lighter is more recent."
      : "Colored by team. Click a legend entry to hide it, double-click to show only that one.";
    el.payNote.textContent = `Dots above the line are paid more than the ${model.label.toLowerCase()} model predicts; dots below are bargains. ${colorNote}${teamScope}`;
    el.ageNote.textContent = `Actual minus predicted salary under the ${model.label.toLowerCase()} model. Above zero means paid more than predicted.${teamScope}`;
  }

  // ---------- Team surplus bars ----------

  function renderTeamBars() {
    const model = modelInfo(state.model);
    const barStyle = (values) => ({
      color: values.map((v) => (v >= 0 ? C.under : C.over)),
      line: { width: 0 },
    });

    if (state.team === "all") {
      const season = state.season;
      if (!hasSalary(season)) {
        el.teamNote.textContent = "Predicted minus actual salary, summed across each roster's qualifying players.";
        showEmpty(el.bars, `${seasonLabel(season)} has no salary data yet. Pick an earlier season to see team surplus.`);
        return;
      }
      const sums = new Map();
      for (const r of recordsFor(season)) {
        if (r.salary == null || isTraded(r.team)) continue;
        const t = sums.get(r.team) || { usd: 0, pct: 0, n: 0 };
        t.usd += r.surplus; t.pct += r.surplus_pct; t.n += 1;
        sums.set(r.team, t);
      }
      const teams = [...sums.entries()].sort((a, b) => b[1].usd - a[1].usd);
      const y = teams.map(([, v]) => v.usd / 1e6);
      draw(el.bars, [{
        type: "bar",
        x: teams.map(([t]) => t),
        y,
        marker: barStyle(y),
        text: teams.map(([t, v]) => `<b>${escapeHtml(teamName(t))}</b><br>Surplus <b>${money(v.usd, { signed: true })}</b> (${pct(v.pct, { signed: true })} of cap)<br>${v.n} qualifying players`),
        hovertemplate: "%{text}<extra></extra>",
        textposition: "none",
      }], baseLayout({
        xaxis: axis("", { tickangle: -60, showgrid: false, tickfont: { color: C.muted, size: 11 } }),
        yaxis: axis(`Total surplus, ${seasonLabel(season)} ($M)`, { tickformat: "$,~f", ticksuffix: "M", zeroline: true, zerolinecolor: C.text2 }),
        bargap: 0.3,
        barcornerradius: 4,
        showlegend: false,
        margin: { l: 64, r: 16, t: 12, b: 64 },
      }));
      el.teamNote.textContent = `${model.label} prediction minus actual salary, summed across each roster's qualifying players in ${seasonLabel(season)}. Blue teams got more production than they paid for. Traded players are left out because their salary can't be split by team.`;
      return;
    }

    // One team across every season with salaries, in % of cap so seasons compare fairly.
    const seasons = state.manifest.seasons.filter((s) => s.has_salary);
    const vals = seasons.map((s) => {
      const rows = recordsFor(s.season).filter((r) => r.team === state.team && r.salary != null);
      return {
        s, n: rows.length,
        usd: rows.reduce((a, r) => a + r.surplus, 0),
        pct: rows.reduce((a, r) => a + r.surplus_pct, 0),
      };
    });
    const y = vals.map((v) => v.pct * 100);
    draw(el.bars, [{
      type: "bar",
      x: vals.map((v) => v.s.label),
      y,
      marker: {
        ...barStyle(y),
        line: { color: vals.map((v) => (v.s.season === state.season ? C.accent : "rgba(0,0,0,0)")), width: 2 },
      },
      text: vals.map((v) => `<b>${escapeHtml(teamName(state.team))}, ${v.s.label}</b><br>Surplus <b>${pct(v.pct, { signed: true })}</b> of cap (${money(v.usd, { signed: true })})<br>${v.n} qualifying players`),
      hovertemplate: "%{text}<extra></extra>",
      textposition: "none",
    }], baseLayout({
      xaxis: axis("", { showgrid: false }),
      yaxis: axis("Total surplus (% of cap)", { ticksuffix: "%", zeroline: true, zerolinecolor: C.text2 }),
      bargap: 0.3,
      barcornerradius: 4,
      showlegend: false,
    }));
    el.teamNote.textContent = `${teamName(state.team)}: ${model.label.toLowerCase()} prediction minus actual salary, summed across qualifying players each season, as a share of that season's cap so the years compare fairly. The outlined bar is the selected season. Traded players are left out.`;
  }

  // ---------- Render all ----------

  function renderAll() {
    syncControls();
    renderCard();
    renderBoard();
    renderScatters();
    renderTeamBars();
    writeHash();
  }

  // ---------- Boot ----------

  async function boot() {
    try {
      await load();
    } catch (err) {
      el.card.replaceChildren();
      const p = document.createElement("p");
      p.className = "card-empty";
      p.textContent = `${err.message}. If you opened index.html straight from disk, serve the folder instead (python -m http.server) so the data files can load.`;
      el.card.append(p);
      return;
    }

    buildControls();

    const withSalary = state.manifest.seasons.filter((s) => s.has_salary);
    state.season = withSalary.length ? withSalary[withSalary.length - 1].season : state.manifest.seasons.at(-1).season;
    readHash();
    state.scatterSeasons = hasSalary(state.season) ? new Set([state.season]) : new Set();
    state.unit = defaultUnit();

    if (!state.player) {
      // Start on the season's best-value player so the card is never empty.
      const rows = recordsFor(state.season);
      const top = hasSalary(state.season)
        ? rows.reduce((a, b) => (b.surplus > a.surplus ? b : a), rows[0])
        : rows[0];
      if (top) { state.player = top.id; state.cardSeason = state.season; }
    }
    if (state.player && !state.cardSeason) {
      const seasons = state.players.get(state.player).seasons;
      state.cardSeason = seasons.includes(state.season) ? state.season : seasons.at(-1);
    }

    wireEvents();
    renderAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
