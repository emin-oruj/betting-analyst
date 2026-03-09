import { useState } from "react";

const API_KEY = process.env.REACT_APP_ODDS_API_KEY;
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const FOOTBALL_API_KEY = process.env.REACT_APP_FOOTBALL_API_KEY;
const FOOTBALL_API_BASE = "/football-api/v4";

// football-data.org competition codes for supported leagues
const FD_COMPETITION_MAP = {
  "premier league": "PL", "epl": "PL",
  "championship": "ELC", "la liga": "PD", "laliga": "PD",
  "serie a": "SA", "bundesliga": "BL1", "ligue 1": "FL1",
  "champions league": "CL", "ucl": "CL",
  "europa league": "EL", "uel": "EL",
  "eredivisie": "DED", "primeira liga": "PPL",
};

// TheSportsDB idLeague → ESPN league slug (global coverage, free, no key)
const SPORTSDB_TO_ESPN = {
  "4328": "eng.1",   // English Premier League
  "4329": "eng.2",   // English Championship
  "4330": "sco.1",   // Scottish Premiership
  "4331": "ger.1",   // Bundesliga
  "4332": "ita.1",   // Serie A
  "4334": "fra.1",   // Ligue 1
  "4335": "esp.1",   // La Liga
  "4336": "eng.2",   // Championship
  "4337": "ned.1",   // Eredivisie
  "4339": "tur.1",   // Süper Lig
  "4340": "gre.1",   // Super League Greece
  "4341": "bel.1",   // Belgian Pro League
  "4342": "ned.1",   // Dutch Eredivisie
  "4344": "por.1",   // Primeira Liga
  "4346": "eng.2",   // Championship
  "4351": "bra.1",   // Brazilian Serie A
  "4352": "bra.2",   // Brazilian Serie B
  "4353": "mex.1",   // Liga MX
  "4354": "col.1",   // Colombian Primera A
  "4355": "chi.1",   // Chilean Primera División
  "4356": "uru.1",   // Uruguayan Primera División
  "4358": "ecu.1",   // Ecuadorian Serie A
  "4359": "ven.1",   // Venezuelan Primera División
  "4380": "usa.1",   // MLS
  "4399": "den.1",   // Danish Superliga
  "4400": "nor.1",   // Eliteserien
  "4401": "swe.1",   // Allsvenskan
  "4402": "fin.1",   // Veikkausliiga
  "4406": "arg.1",   // Argentine Primera División
  "4407": "per.1",   // Peruvian Primera División
  "4408": "par.1",   // Paraguayan División Profesional
  "4409": "bol.1",   // Bolivian Liga Profesional
  "4418": "chn.1",   // Chinese Super League
  "4480": "UEFA.CHAMPIONS_LEAGUE",
  "4481": "UEFA.EUROPA_LEAGUE",
  "4482": "eng.fa_cup",
  "4570": "eng.league_cup",
  "4633": "jpn.1",   // J1 League
  "4644": "kor.1",   // K League 1
  "4750": "sau.1",   // Saudi Pro League
  "4818": "aus.1",   // A-League
  "4829": "egy.1",   // Egyptian Premier League
};

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

// Build form string from ESPN completed events for a given team ID
function formFromESPNEvents(events, teamId, lastX) {
  const completed = events
    .filter(e => e.competitions?.[0]?.status?.type?.completed)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, lastX);
  return completed.map(e => {
    const c = e.competitions[0];
    const me = c.competitors.find(x => String(x.team?.id) === String(teamId));
    if (!me) return null;
    const ms = typeof me.score === "object" ? (me.score.value ?? 0) : parseFloat(me.score || 0);
    const opp = c.competitors.find(x => String(x.team?.id) !== String(teamId));
    const os = opp ? (typeof opp.score === "object" ? (opp.score.value ?? 0) : parseFloat(opp.score || 0)) : 0;
    if (me.winner) return "W";
    if (ms === os) return "D";
    return "L";
  }).filter(Boolean).join("");
}

// Derive form string from football-data.org team matches
function formFromFDMatches(matches, teamId, lastX) {
  const finished = matches.filter(m => m.score?.fullTime?.home !== null && m.score?.fullTime?.away !== null);
  const recent = finished.slice(-lastX);
  return recent.map(m => {
    const isHome = m.homeTeam.id === teamId;
    const h = m.score.fullTime.home;
    const a = m.score.fullTime.away;
    if (isHome) return h > a ? "W" : h < a ? "L" : "D";
    return a > h ? "W" : a < h ? "L" : "D";
  }).filter(Boolean).join("");
}

// Global team form fetcher: works for any team worldwide
// Strategy: TheSportsDB search (global) → ESPN schedule (free, global)
//           with football-data.org as secondary for European leagues
async function fetchTeamForm(teamName, league, lastX) {
  const nTeam = norm(teamName);

  // ── Step 1: Search TheSportsDB for the team (works for any team globally) ──
  let sdbTeam = null;
  try {
    const res = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(teamName)}`
    );
    if (res.ok) {
      const data = await res.json();
      sdbTeam = (data.teams || []).find(t =>
        t.strSport === "Soccer" &&
        (norm(t.strTeam).includes(nTeam) || nTeam.includes(norm(t.strTeam)) ||
         norm(t.strTeamShort || "").includes(nTeam) || nTeam.includes(norm(t.strTeamShort || "")))
      );
    }
  } catch { /* continue */ }

  // ── Step 2: Try football-data.org for European leagues it supports ──
  const fdCode = sdbTeam ? null : FD_COMPETITION_MAP[league.toLowerCase().trim()];
  const sdbFdCode = sdbTeam ? FD_COMPETITION_MAP[
    Object.keys(FD_COMPETITION_MAP).find(k =>
      sdbTeam.strLeague && norm(sdbTeam.strLeague).includes(norm(k))
    ) || ""
  ] : null;
  const resolvedFdCode = fdCode || sdbFdCode;

  if (resolvedFdCode) {
    try {
      const teamsRes = await fetch(`${FOOTBALL_API_BASE}/competitions/${resolvedFdCode}/teams`, {
        headers: { "X-Auth-Token": FOOTBALL_API_KEY },
      });
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        const fdTeam = (teamsData.teams || []).find(t =>
          norm(t.name).includes(nTeam) || nTeam.includes(norm(t.name)) ||
          norm(t.shortName || "").includes(nTeam) || nTeam.includes(norm(t.shortName || ""))
        );
        if (fdTeam) {
          const matchesRes = await fetch(
            `${FOOTBALL_API_BASE}/teams/${fdTeam.id}/matches?status=FINISHED&limit=${lastX + 5}`,
            { headers: { "X-Auth-Token": FOOTBALL_API_KEY } }
          );
          if (matchesRes.ok) {
            const matchesData = await matchesRes.json();
            const form = formFromFDMatches(matchesData.matches || [], fdTeam.id, lastX);
            if (form) return { form, officialName: fdTeam.shortName || fdTeam.name };
          }
        }
      }
    } catch { /* fall through to ESPN */ }
  }

  // ── Step 3: ESPN (free, global, no key — covers 100+ leagues worldwide) ──
  // Determine which ESPN slug(s) to try
  const espnSlugFromSDB = sdbTeam ? SPORTSDB_TO_ESPN[sdbTeam.idLeague] : null;
  const hintSlugs = espnSlugFromSDB ? [espnSlugFromSDB] : [];

  // Candidate slugs to search for the team (in order of likelihood)
  const candidateSlugs = [
    ...hintSlugs,
    // Major leagues as broad fallback if no hint
    ...( hintSlugs.length === 0 ? [
      "eng.1","esp.1","ita.1","ger.1","fra.1","por.1","ned.1","bra.1",
      "arg.1","mex.1","usa.1","tur.1","sco.1","bel.1","kor.1","jpn.1",
      "sau.1","egy.1","chi.1","col.1","chn.1","aus.1","gre.1","den.1",
      "nor.1","swe.1","uru.1","ecu.1","per.1",
      "eng.fa_cup","eng.league_cup","UEFA.CHAMPIONS_LEAGUE","UEFA.EUROPA_LEAGUE",
    ] : [
      // If we have a hint slug, also search broad leagues in case team plays in cups
      "eng.1","esp.1","ita.1","ger.1","fra.1","bra.1","arg.1","mex.1",
      "sau.1","tur.1","sco.1","ned.1","por.1","jpn.1","kor.1","egy.1",
    ])
  ];

  let espnTeamId = null;
  let officialName = null;
  let foundInSlug = null;

  for (const slug of candidateSlugs) {
    try {
      const res = await fetch(`${ESPN_BASE}/${slug}/teams`);
      if (!res.ok) continue;
      const data = await res.json();
      const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
      const match = teams.find(t => {
        const dn = norm(t.team?.displayName || "");
        const sn = norm(t.team?.shortDisplayName || "");
        const ab = norm(t.team?.abbreviation || "");
        return dn.includes(nTeam) || nTeam.includes(dn) ||
               sn.includes(nTeam) || nTeam.includes(sn) ||
               (ab.length > 2 && ab === nTeam);
      });
      if (match) {
        espnTeamId = match.team.id;
        officialName = match.team.shortDisplayName || match.team.displayName;
        foundInSlug = slug;
        break;
      }
    } catch { continue; }
  }

  if (!espnTeamId) return null;

  // Fetch schedule — use the slug where we found the team
  try {
    const schedRes = await fetch(`${ESPN_BASE}/${foundInSlug}/teams/${espnTeamId}/schedule`);
    if (!schedRes.ok) return null;
    const schedData = await schedRes.json();
    const form = formFromESPNEvents(schedData.events || [], espnTeamId, lastX);
    return { form: form || null, officialName };
  } catch {
    return null;
  }
}

const LEAGUE_MAP = {
  "premier league": "soccer_epl",
  "epl": "soccer_epl",
  "la liga": "soccer_spain_la_liga",
  "laliga": "soccer_spain_la_liga",
  "serie a": "soccer_italy_serie_a",
  "bundesliga": "soccer_germany_bundesliga",
  "ligue 1": "soccer_france_ligue_one",
  "champions league": "soccer_uefa_champs_league",
  "ucl": "soccer_uefa_champs_league",
  "europa league": "soccer_uefa_europa_league",
  "mls": "soccer_usa_mls",
  "eredivisie": "soccer_netherlands_eredivisie",
  "primeira liga": "soccer_portugal_primeira_liga",
  "nba": "basketball_nba",
  "nfl": "americanfootball_nfl",
  "nhl": "icehockey_nhl",
  "mlb": "baseball_mlb",
};

const emptyMatch = () => ({ teamA: "", teamB: "", league: "", date: "", h2h: "", formA: "", formB: "", context: "" });

const decimalToAmerican = (d) => d >= 2 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`;
const decimalToImplied = (d) => Math.round((1 / d) * 100);
const americanToPayout = (american, stake) => {
  const a = parseFloat(american);
  if (a > 0) return stake * (a / 100);
  return stake * (100 / Math.abs(a));
};

const BM_LABELS = {
  williamhill_us: "Caesars",
  fanduel: "FanDuel",
  draftkings: "DraftKings",
  betmgm: "BetMGM",
  pointsbetus: "PointsBet",
  unibet_us: "Unibet",
  bovada: "Bovada",
  betonlineag: "BetOnline",
  mybookieag: "MyBookie",
  lowvig: "LowVig",
  espnbet: "ESPN Bet",
};

function extractH2H(bm, homeTeam, awayTeam) {
  const h2h = bm.markets.find(m => m.key === "h2h");
  if (!h2h) return null;
  const result = {};
  h2h.outcomes.forEach(o => {
    if (o.name === homeTeam) result.home = o.price;
    else if (o.name === awayTeam) result.away = o.price;
    else if (o.name === "Draw") result.draw = o.price;
  });
  return result.home ? result : null;
}

async function fetchLiveOdds(match) {
  const leagueKey = LEAGUE_MAP[match.league.toLowerCase().trim()];
  if (!leagueKey) return null;
  try {
    const res = await fetch(
      `${ODDS_API_BASE}/sports/${leagueKey}/odds/?apiKey=${API_KEY}&regions=us&markets=h2h,totals&oddsFormat=decimal`
    );
    if (!res.ok) return null;
    const games = await res.json();
    const nA = norm(match.teamA);
    const nB = norm(match.teamB);
    const game = games.find(g => {
      const h = norm(g.home_team);
      const a = norm(g.away_team);
      return (h.includes(nA) || nA.includes(h)) && (a.includes(nB) || nB.includes(a));
    });
    if (!game) return null;

    // Extract all bookmakers for consensus
    const allBookmakers = game.bookmakers
      .map(bm => {
        const h2h = extractH2H(bm, game.home_team, game.away_team);
        if (!h2h) return null;
        return { key: bm.key, label: BM_LABELS[bm.key] ?? bm.title, ...h2h };
      })
      .filter(Boolean);

    // Caesars as primary source
    const caesarsBm = game.bookmakers.find(b => b.key === "williamhill_us") ?? game.bookmakers[0];
    if (!caesarsBm) return null;

    const odds = { allBookmakers };
    const h2h = caesarsBm.markets.find(m => m.key === "h2h");
    const totals = caesarsBm.markets.find(m => m.key === "totals");
    if (h2h) {
      h2h.outcomes.forEach(o => {
        if (o.name === game.home_team) odds.homeOdds = o.price;
        else if (o.name === game.away_team) odds.awayOdds = o.price;
        else if (o.name === "Draw") odds.drawOdds = o.price;
      });
    }
    if (totals) {
      totals.outcomes.forEach(o => {
        if (o.name === "Over") odds.overOdds = o.price;
        else if (o.name === "Under") odds.underOdds = o.price;
        if (o.point) odds.ouLine = o.point;
      });
    }
    return odds;
  } catch {
    return null;
  }
}

function generateAnalysis(match, lastX, liveOdds) {
  const { teamA, teamB, h2h, formA, formB, context } = match;

  const parseForm = (form) => {
    const chars = (form || "").toUpperCase().replace(/[^WDL]/g, "").split("");
    const w = chars.filter(c => c === "W").length;
    const d = chars.filter(c => c === "D").length;
    const l = chars.filter(c => c === "L").length;
    const total = w + d + l || 1;
    return { w, d, l, total, pts: (w * 3 + d) / (total * 3) };
  };

  const fA = parseForm(formA);
  const fB = parseForm(formB);

  const homeBoost = 0.08;
  const rawA = fA.pts + homeBoost;
  const rawB = fB.pts;
  const rawD = 0.25;
  const sum = rawA + rawB + rawD;
  const pA = Math.min(0.75, Math.max(0.1, rawA / sum));
  const pB = Math.min(0.65, Math.max(0.1, rawB / sum));
  const pD = Math.max(0.1, 1 - pA - pB);

  const edgeFn = (real, implied) => {
    const e = real - implied;
    return (e > 0 ? "+" : "") + Math.round(e * 100) + "%";
  };

  const impliedA = liveOdds?.homeOdds ? decimalToImplied(liveOdds.homeOdds) : Math.round(pA * 93);
  const impliedD = liveOdds?.drawOdds ? decimalToImplied(liveOdds.drawOdds) : Math.round(pD * 93);
  const impliedB = liveOdds?.awayOdds ? decimalToImplied(liveOdds.awayOdds) : Math.round(pB * 93);

  const realA = Math.round(pA * 100);
  const realD = Math.round(pD * 100);
  const realB = Math.round(pB * 100);

  const avgForm = (fA.pts + fB.pts) / 2;
  const overProb = Math.round((0.45 + avgForm * 0.3) * 100);
  const underProb = 100 - overProb;
  const overImplied = liveOdds?.overOdds ? decimalToImplied(liveOdds.overOdds) : Math.round(overProb * 0.92);
  const underImplied = liveOdds?.underOdds ? decimalToImplied(liveOdds.underOdds) : Math.round(underProb * 0.92);
  const ouLine = liveOdds?.ouLine ?? 2.5;
  const overEdge = overProb - overImplied;
  const underEdge = underProb - underImplied;
  const betOver = overEdge >= underEdge;

  // Base BTTS rate ~45% (soccer average), scales up with attacking form
  const bttsProb = liveOdds?.bttsYesOdds
    ? decimalToImplied(liveOdds.bttsYesOdds)
    : Math.min(70, Math.round(45 + (fA.pts + fB.pts) * 12.5));
  const bttsImplied = liveOdds?.bttsYesOdds ? decimalToImplied(liveOdds.bttsYesOdds) : Math.round(bttsProb * 0.91);

  const favTeam = pA > pB ? teamA : teamB;
  const ahProb = Math.round(Math.max(pA, pB) * 100);
  const ahImplied = Math.round(ahProb * 0.92);

  // Double Chance: all 3 options
  const dcOptions = [
    {
      label: `${teamA} or Draw`,
      real: Math.round((pA + pD) * 100),
      implied: liveOdds?.homeOdds && liveOdds?.drawOdds
        ? Math.round((1 - (1/liveOdds.homeOdds + 1/liveOdds.drawOdds) * 0.93) * 100 + (pA + pD) * 93 * 0)
        // simpler: use combined implied from live odds
        : Math.round((pA + pD) * 92),
      caesarsDecimal: liveOdds?.homeOdds && liveOdds?.drawOdds
        ? 1 / ((decimalToImplied(liveOdds.homeOdds)/100 + decimalToImplied(liveOdds.drawOdds)/100) * 0.95)
        : null,
    },
    {
      label: `${teamB} or Draw`,
      real: Math.round((pB + pD) * 100),
      implied: liveOdds?.awayOdds && liveOdds?.drawOdds
        ? Math.round((pB + pD) * 92)
        : Math.round((pB + pD) * 92),
      caesarsDecimal: liveOdds?.awayOdds && liveOdds?.drawOdds
        ? 1 / ((decimalToImplied(liveOdds.awayOdds)/100 + decimalToImplied(liveOdds.drawOdds)/100) * 0.95)
        : null,
    },
    {
      label: `${teamA} or ${teamB}`,
      real: Math.round((pA + pB) * 100),
      implied: liveOdds?.homeOdds && liveOdds?.awayOdds
        ? Math.round((pA + pB) * 92)
        : Math.round((pA + pB) * 92),
      caesarsDecimal: liveOdds?.homeOdds && liveOdds?.awayOdds
        ? 1 / ((decimalToImplied(liveOdds.homeOdds)/100 + decimalToImplied(liveOdds.awayOdds)/100) * 0.95)
        : null,
    },
  ].map(dc => ({
    ...dc,
    edge: dc.real - dc.implied,
    caesars: dc.caesarsDecimal ? decimalToAmerican(dc.caesarsDecimal) : null,
  }));
  const bestDC = dcOptions.reduce((a, b) => a.edge > b.edge ? a : b);

  const riskLevel = (real, implied) => {
    const e = real - implied;
    if (e >= 8) return "Low";
    if (e >= 3) return "Medium";
    return "High";
  };
  const verdict = (real, implied) => real - implied >= 4 ? "✓" : "✗";

  const rows = [
    {
      market: `${teamA} Win`,
      implied: `${impliedA}%`,
      real: `${realA}%`,
      caesars: liveOdds?.homeOdds ? decimalToAmerican(liveOdds.homeOdds) : null,
      caesarsDecimal: liveOdds?.homeOdds ?? null,
      edge: edgeFn(pA, impliedA / 100),
      risk: riskLevel(realA, impliedA),
      verdict: verdict(realA, impliedA),
      reason: `${teamA} home advantage + form`,
      parlayKey: "home",
    },
    {
      market: "Draw",
      implied: `${impliedD}%`,
      real: `${realD}%`,
      caesars: liveOdds?.drawOdds ? decimalToAmerican(liveOdds.drawOdds) : null,
      caesarsDecimal: liveOdds?.drawOdds ?? null,
      edge: edgeFn(pD, impliedD / 100),
      risk: riskLevel(realD, impliedD),
      verdict: verdict(realD, impliedD),
      reason: `Level form — draw probability elevated`,
      parlayKey: "draw",
    },
    {
      market: `${teamB} Win`,
      implied: `${impliedB}%`,
      real: `${realB}%`,
      caesars: liveOdds?.awayOdds ? decimalToAmerican(liveOdds.awayOdds) : null,
      caesarsDecimal: liveOdds?.awayOdds ?? null,
      edge: edgeFn(pB, impliedB / 100),
      risk: riskLevel(realB, impliedB),
      verdict: verdict(realB, impliedB),
      reason: `${teamB} away form`,
      parlayKey: "away",
    },
    ...dcOptions.map(dc => ({
      market: dc.label,
      implied: `${dc.implied}%`,
      real: `${dc.real}%`,
      caesars: dc.caesars,
      caesarsDecimal: dc.caesarsDecimal,
      edge: edgeFn(dc.real / 100, dc.implied / 100),
      risk: riskLevel(dc.real, dc.implied),
      verdict: verdict(dc.real, dc.implied),
      reason: `Double chance — covers two of three outcomes`,
      parlayKey: null,
      group: "dc",
    })),
    {
      market: betOver ? `Over ${ouLine}` : `Under ${ouLine}`,
      implied: betOver ? `${overImplied}%` : `${underImplied}%`,
      real: betOver ? `${overProb}%` : `${underProb}%`,
      caesars: liveOdds?.overOdds
        ? betOver ? decimalToAmerican(liveOdds.overOdds) : decimalToAmerican(liveOdds.underOdds)
        : null,
      caesarsDecimal: liveOdds?.overOdds
        ? betOver ? liveOdds.overOdds : liveOdds.underOdds
        : null,
      edge: betOver ? edgeFn(overProb / 100, overImplied / 100) : edgeFn(underProb / 100, underImplied / 100),
      risk: betOver ? riskLevel(overProb, overImplied) : riskLevel(underProb, underImplied),
      verdict: betOver ? verdict(overProb, overImplied) : verdict(underProb, underImplied),
      reason: betOver
        ? `Over ${ouLine} — both teams in ${avgForm > 0.55 ? "strong" : "decent"} attacking form`
        : `Under ${ouLine} — cautious form suggests fewer goals`,
      parlayKey: betOver ? "over" : "under",
    },
    {
      market: "Both Teams to Score",
      implied: `${bttsImplied}%`,
      real: `${bttsProb}%`,
      caesars: null,
      caesarsDecimal: null,
      edge: edgeFn(bttsProb / 100, bttsImplied / 100),
      risk: riskLevel(bttsProb, bttsImplied),
      verdict: verdict(bttsProb, bttsImplied),
      reason: bttsProb > 55 ? "Both sides show scoring form" : "One side may keep a clean sheet",
      parlayKey: "btts",
    },
    {
      market: `Asian Handicap (${favTeam} -0.5)`,
      implied: `${ahImplied}%`,
      real: `${ahProb}%`,
      caesars: null,
      caesarsDecimal: null,
      edge: edgeFn(ahProb / 100, ahImplied / 100),
      risk: riskLevel(ahProb, ahImplied),
      verdict: verdict(ahProb, ahImplied),
      reason: `${favTeam} form points to winning margin`,
      parlayKey: null,
      group: null,
    },
    // Match Result & Both Teams to Score combined markets
    // Combined decimal = (win_decimal * btts_decimal) / 1.10  to avoid double-margining
    // Match Result & Both Teams to Score combined markets
    // Caesars method: remove vig from each market → multiply fair probs → apply single margin
    ...[
      { team: teamA, p: pA, winOdds: liveOdds?.homeOdds, key: "bttsHome" },
      { team: "Draw",  p: pD, winOdds: liveOdds?.drawOdds, key: "bttsDraw" },
      { team: teamB, p: pB, winOdds: liveOdds?.awayOdds, key: "bttsAway" },
    ].map(({ team, p, winOdds, key }) => {
      let combinedDecimal;
      if (liveOdds?.homeOdds && liveOdds?.drawOdds && liveOdds?.awayOdds && liveOdds?.bttsYesOdds && liveOdds?.bttsNoOdds) {
        // Step 1: remove vig to get fair probabilities
        const h2hOver = 1/liveOdds.homeOdds + 1/liveOdds.drawOdds + 1/liveOdds.awayOdds;
        const bttsOver = 1/liveOdds.bttsYesOdds + 1/liveOdds.bttsNoOdds;
        const fairWin  = (1 / winOdds) / h2hOver;
        const fairBtts = (1 / liveOdds.bttsYesOdds) / bttsOver;
        // Step 2: multiply fair probs, Step 3: apply single ~7% margin
        combinedDecimal = 1 / (fairWin * fairBtts * 0.93);
      } else {
        // No live odds — use model probs with single margin
        combinedDecimal = 1 / (p * (bttsProb / 100) * 0.93);
      }
      const realPct    = Math.round(p * (bttsProb / 100) * 100);
      const impliedPct = Math.round((1 / combinedDecimal) * 100);
      return {
        market: team === "Draw" ? "Draw & BTTS" : `${team} Win & BTTS`,
        implied: `${impliedPct}%`,
        real: `${realPct}%`,
        caesars: liveOdds?.bttsYesOdds ? decimalToAmerican(combinedDecimal) : null,
        caesarsDecimal: liveOdds?.bttsYesOdds ? combinedDecimal : null,
        edge: edgeFn(realPct / 100, impliedPct / 100),
        risk: riskLevel(realPct, impliedPct),
        verdict: verdict(realPct, impliedPct),
        reason: team === "Draw" ? "Scoring draw — both sides find the net" : `${team} win with both sides scoring`,
        parlayKey: key,
        group: "btts_result",
      };
    }),
  ];

  const valueBets = rows.filter(r => r.verdict === "✓").sort((a, b) => parseInt(b.edge) - parseInt(a.edge));

  const formLabel = (team, form, pts, w, d, l) => {
    if (!form || (w + d + l === 0)) return { team, text: "No form data provided", pts: null };
    return { team, text: `${form.toUpperCase()}  —  ${w}W ${d}D ${l}L  ·  ${Math.round(pts * 100)}% pts ratio`, pts };
  };

  const keyFactors = [];
  if (fA.pts > fB.pts)
    keyFactors.push(`${teamA} hold superior recent form — home win probability ${realA}% (includes +8% home boost)`);
  else if (fB.pts > fA.pts)
    keyFactors.push(`${teamB} arrive in better form — away win probability ${realB}% despite travelling`);
  else
    keyFactors.push(`Both sides level on form — draw probability elevated at ${realD}%`);
  if (h2h) keyFactors.push(`Head-to-head: ${h2h}`);
  if (context) keyFactors.push(`Additional context: ${context}`);
  keyFactors.push(liveOdds ? "Live Caesars odds loaded — edge calculated against real market lines" : "No live odds found — using estimated bookmaker margin");

  const parlayOdds = {
    home: liveOdds?.homeOdds ?? (1 / pA),
    draw: liveOdds?.drawOdds ?? (1 / pD),
    away: liveOdds?.awayOdds ?? (1 / pB),
    over: liveOdds?.overOdds ?? (1 / (overProb / 100)),
    under: liveOdds?.underOdds ?? (1 / (underProb / 100)),
    btts: 1 / (bttsProb / 100),
    bttsHome: (() => {
      if (liveOdds?.homeOdds && liveOdds?.drawOdds && liveOdds?.awayOdds && liveOdds?.bttsYesOdds && liveOdds?.bttsNoOdds) {
        const h2hOver = 1/liveOdds.homeOdds + 1/liveOdds.drawOdds + 1/liveOdds.awayOdds;
        const bttsOver = 1/liveOdds.bttsYesOdds + 1/liveOdds.bttsNoOdds;
        return 1 / ((1/liveOdds.homeOdds / h2hOver) * (1/liveOdds.bttsYesOdds / bttsOver) * 0.93);
      }
      return 1 / (pA * (bttsProb / 100) * 0.93);
    })(),
    bttsDraw: (() => {
      if (liveOdds?.drawOdds && liveOdds?.homeOdds && liveOdds?.awayOdds && liveOdds?.bttsYesOdds && liveOdds?.bttsNoOdds) {
        const h2hOver = 1/liveOdds.homeOdds + 1/liveOdds.drawOdds + 1/liveOdds.awayOdds;
        const bttsOver = 1/liveOdds.bttsYesOdds + 1/liveOdds.bttsNoOdds;
        return 1 / ((1/liveOdds.drawOdds / h2hOver) * (1/liveOdds.bttsYesOdds / bttsOver) * 0.93);
      }
      return 1 / (pD * (bttsProb / 100) * 0.93);
    })(),
    bttsAway: (() => {
      if (liveOdds?.awayOdds && liveOdds?.homeOdds && liveOdds?.drawOdds && liveOdds?.bttsYesOdds && liveOdds?.bttsNoOdds) {
        const h2hOver = 1/liveOdds.homeOdds + 1/liveOdds.drawOdds + 1/liveOdds.awayOdds;
        const bttsOver = 1/liveOdds.bttsYesOdds + 1/liveOdds.bttsNoOdds;
        return 1 / ((1/liveOdds.awayOdds / h2hOver) * (1/liveOdds.bttsYesOdds / bttsOver) * 0.93);
      }
      return 1 / (pB * (bttsProb / 100) * 0.93);
    })(),
  };

  const summary = {
    formA: formLabel(teamA, formA, fA.pts, fA.w, fA.d, fA.l),
    formB: formLabel(teamB, formB, fB.pts, fB.w, fB.d, fB.l),
    probLine: `${teamA} ${realA}%  ·  Draw ${realD}%  ·  ${teamB} ${realB}%`,
    keyFactors,
    valueBets,
    lastX,
    liveOdds: !!liveOdds,
    realA, realD, realB,
    allBookmakers: liveOdds?.allBookmakers ?? [],
  };

  return { rows, summary, parlayOdds };
}

function MatchCard({ match, index, onChange, onRemove, total, lastX }) {
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const f = (key) => (e) => onChange(index, key, e.target.value);

  const correctTeamName = (key, value) => {
    if (!value) return;
    const titled = value.replace(/\b\w/g, c => c.toUpperCase());
    if (titled !== value) onChange(index, key, titled);
  };

  const autoFillForm = async () => {
    if (!match.teamA || !match.teamB || !match.league) {
      setFetchMsg("Fill in Home Team, Away Team and League first.");
      return;
    }
    setFetching(true);
    setFetchMsg("Fetching form...");
    const [rA, rB] = await Promise.all([
      fetchTeamForm(match.teamA, match.league, lastX),
      fetchTeamForm(match.teamB, match.league, lastX),
    ]);
    if (rA?.form) { onChange(index, "formA", rA.form); onChange(index, "teamA", rA.officialName); }
    if (rB?.form) { onChange(index, "formB", rB.form); onChange(index, "teamB", rB.officialName); }
    if (!rA && !rB) setFetchMsg("Teams not found — check spellings match the league (e.g. 'Newcastle United' not 'Newcastle').");
    else if (!rA) setFetchMsg(`Found ${rB?.officialName} but not ${match.teamA} — check spelling.`);
    else if (!rB) setFetchMsg(`Found ${rA?.officialName} but not ${match.teamB} — check spelling.`);
    else setFetchMsg(`Form loaded: ${rA.officialName} ${rA.form} · ${rB.officialName} ${rB.form}`);
    setFetching(false);
  };

  return (
    <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "18px 20px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ color: "#86efac", fontFamily: "monospace", fontSize: 11, letterSpacing: 2 }}>MATCH {index + 1}</span>
        {total > 1 && <button onClick={() => onRemove(index)} style={{ background: "none", border: "1px solid #7f1d1d", borderRadius: 5, color: "#f87171", cursor: "pointer", padding: "2px 10px", fontSize: 11 }}>Remove</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {[["teamA","Home Team","e.g. Arsenal"],["teamB","Away Team","e.g. Chelsea"],["league","League","e.g. Premier League"],["date","Date",""]].map(([key, label, ph]) => (
          <div key={key}>
            <div style={{ color: "#6b7280", fontSize: 10, fontFamily: "monospace", marginBottom: 4, letterSpacing: 1 }}>{label.toUpperCase()}</div>
            <input
              type={key === "date" ? "date" : "text"}
              value={match[key]}
              onChange={f(key)}
              onBlur={key === "teamA" || key === "teamB" || key === "league" ? () => correctTeamName(key, match[key]) : undefined}
              placeholder={ph}
              style={{ width: "100%", background: "#0f172a", border: "1px solid #374151", borderRadius: 6, padding: "8px 10px", color: "#f9fafb", fontFamily: "monospace", fontSize: 13, outline: "none", colorScheme: "dark" }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <button onClick={autoFillForm} disabled={fetching} style={{ background: fetching ? "#1a2e1a" : "#052e16", border: "1px solid #166534", borderRadius: 6, padding: "6px 14px", color: "#86efac", fontFamily: "monospace", fontSize: 11, cursor: fetching ? "wait" : "pointer", letterSpacing: 1 }}>
          {fetching ? "FETCHING..." : "⚡ AUTO-FILL FORM"}
        </button>
        {fetchMsg && <span style={{ fontFamily: "monospace", fontSize: 11, color: fetchMsg.includes("not found") || fetchMsg.includes("Fill in") ? "#f87171" : "#86efac" }}>{fetchMsg}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ color: "#6b7280", fontSize: 10, fontFamily: "monospace", marginBottom: 4, letterSpacing: 1 }}>HOME FORM (e.g. WWDLL)</div>
          <input value={match.formA} onChange={f("formA")} placeholder="W W D L W" maxLength={10}
            style={{ width: "100%", background: "#0f172a", border: "1px solid #374151", borderRadius: 6, padding: "8px 10px", color: "#86efac", fontFamily: "monospace", fontSize: 13, outline: "none", textTransform: "uppercase" }} />
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: 10, fontFamily: "monospace", marginBottom: 4, letterSpacing: 1 }}>AWAY FORM (e.g. WLLWD)</div>
          <input value={match.formB} onChange={f("formB")} placeholder="W L L W D" maxLength={10}
            style={{ width: "100%", background: "#0f172a", border: "1px solid #374151", borderRadius: 6, padding: "8px 10px", color: "#f87171", fontFamily: "monospace", fontSize: 13, outline: "none", textTransform: "uppercase" }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ color: "#6b7280", fontSize: 10, fontFamily: "monospace", marginBottom: 4, letterSpacing: 1 }}>H2H NOTE (optional)</div>
          <input value={match.h2h} onChange={f("h2h")} placeholder="e.g. Home won last 3"
            style={{ width: "100%", background: "#0f172a", border: "1px solid #374151", borderRadius: 6, padding: "8px 10px", color: "#f9fafb", fontFamily: "monospace", fontSize: 12, outline: "none" }} />
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: 10, fontFamily: "monospace", marginBottom: 4, letterSpacing: 1 }}>CONTEXT (optional)</div>
          <input value={match.context} onChange={f("context")} placeholder="e.g. Key striker injured"
            style={{ width: "100%", background: "#0f172a", border: "1px solid #374151", borderRadius: 6, padding: "8px 10px", color: "#f9fafb", fontFamily: "monospace", fontSize: 12, outline: "none" }} />
        </div>
      </div>
    </div>
  );
}

function BookmakerConsensus({ match, summary }) {
  if (!summary.allBookmakers?.length) return null;
  const bms = summary.allBookmakers;

  // Best odds in each column (highest decimal = best for bettor)
  const bestHome = Math.max(...bms.map(b => b.home));
  const bestDraw = Math.max(...bms.filter(b => b.draw).map(b => b.draw));
  const bestAway = Math.max(...bms.map(b => b.away));

  // Consensus: average no-vig implied probability across all books
  const avgHomeImplied = Math.round(bms.reduce((s, b) => {
    const ov = 1/b.home + (b.draw ? 1/b.draw : 0) + 1/b.away;
    return s + (1/b.home) / ov;
  }, 0) / bms.length * 100);
  const avgDrawImplied = bms[0]?.draw ? Math.round(bms.reduce((s, b) => {
    const ov = 1/b.home + (b.draw ? 1/b.draw : 0) + 1/b.away;
    return s + (b.draw ? (1/b.draw) / ov : 0);
  }, 0) / bms.length * 100) : null;
  const avgAwayImplied = Math.round(bms.reduce((s, b) => {
    const ov = 1/b.home + (b.draw ? 1/b.draw : 0) + 1/b.away;
    return s + (1/b.away) / ov;
  }, 0) / bms.length * 100);

  const hasDraw = bms.some(b => b.draw);

  return (
    <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 2, color: "#3b82f6", marginBottom: 12, textTransform: "uppercase", fontWeight: 700 }}>
        Market Consensus — {bms.length} Sportsbooks
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
          <thead>
            <tr>
              {["Sportsbook", match.teamA, ...(hasDraw ? ["Draw"] : []), match.teamB].map((h, i) => (
                <th key={i} style={{ padding: "6px 10px", textAlign: i === 0 ? "left" : "center", borderBottom: "1px solid #1e3a5f", color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bms.map((bm, ri) => (
              <tr key={ri} style={{ borderBottom: "1px solid #0f1e35" }}>
                <td style={{ padding: "6px 10px", color: bm.label === "Caesars" ? "#fbbf24" : "#9ca3af", fontWeight: bm.label === "Caesars" ? 700 : 400 }}>{bm.label}</td>
                <td style={{ padding: "6px 10px", textAlign: "center", color: bm.home === bestHome ? "#86efac" : "#e2e8f0", fontWeight: bm.home === bestHome ? 700 : 400 }}>{decimalToAmerican(bm.home)}</td>
                {hasDraw && <td style={{ padding: "6px 10px", textAlign: "center", color: bm.draw && bm.draw === bestDraw ? "#86efac" : "#e2e8f0", fontWeight: bm.draw && bm.draw === bestDraw ? 700 : 400 }}>{bm.draw ? decimalToAmerican(bm.draw) : "—"}</td>}
                <td style={{ padding: "6px 10px", textAlign: "center", color: bm.away === bestAway ? "#86efac" : "#e2e8f0", fontWeight: bm.away === bestAway ? 700 : 400 }}>{decimalToAmerican(bm.away)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #1e3a5f" }}>
              <td style={{ padding: "6px 10px", color: "#3b82f6", fontWeight: 700, fontSize: 10, letterSpacing: 1 }}>CONSENSUS</td>
              <td style={{ padding: "6px 10px", textAlign: "center", color: "#60a5fa", fontWeight: 700 }}>{avgHomeImplied}%</td>
              {hasDraw && <td style={{ padding: "6px 10px", textAlign: "center", color: "#60a5fa", fontWeight: 700 }}>{avgDrawImplied}%</td>}
              <td style={{ padding: "6px 10px", textAlign: "center", color: "#60a5fa", fontWeight: 700 }}>{avgAwayImplied}%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 10, color: "#374151" }}>
        Green = best available odds. Consensus = average no-vig probability across all books.
      </div>
    </div>
  );
}

function MatchResult({ match, analysis, index }) {
  const { rows, summary } = analysis;
  const riskColor = (v) => v === "Low" ? "#86efac" : v === "High" ? "#f87171" : "#fde047";
  const verdictColor = (v) => v === "✓" ? "#86efac" : "#f87171";
  const hasLiveOdds = rows.some(r => r.caesars);

  const SectionLabel = ({ children }) => (
    <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 2, color: "#3b82f6", marginBottom: 10, textTransform: "uppercase", fontWeight: 700 }}>{children}</div>
  );

  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 12, padding: "22px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ background: "#166534", color: "#86efac", fontFamily: "monospace", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4, letterSpacing: 2 }}>MATCH {index + 1}</span>
        <span style={{ color: "#f9fafb", fontSize: 15, fontWeight: 600 }}>{match.teamA} vs {match.teamB}</span>
        {summary.liveOdds && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#86efac", background: "#052e16", border: "1px solid #166534", padding: "2px 8px", borderRadius: 4 }}>LIVE CAESARS ODDS</span>}
        <span style={{ color: "#6b7280", fontSize: 12, marginLeft: "auto", fontFamily: "monospace" }}>{match.league} · {match.date}</span>
      </div>

      <div style={{ overflowX: "auto", marginBottom: 22 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
          <thead>
            <tr>
              {["Market", ...(hasLiveOdds ? ["Caesars Odds"] : []), "Implied Prob", "Model Prob", "Value Edge", "Risk", "Verdict", "Reasoning"].map((h, i) => (
                <th key={i} style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #1e3a5f", color: h === "Caesars Odds" ? "#fbbf24" : "#60a5fa", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, background: "#0a1628", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.filter(r => !r.group && r.market !== "Double Chance").map((row, ri) => (
              <tr key={ri} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "8px 12px", color: "#f9fafb", background: ri % 2 ? "#0a1628" : "transparent", whiteSpace: "nowrap", fontWeight: 600 }}>{row.market}</td>
                {hasLiveOdds && <td style={{ padding: "8px 12px", color: row.caesars ? "#fbbf24" : "#374151", background: ri % 2 ? "#0a1628" : "transparent", fontWeight: 700 }}>{row.caesars ?? "—"}</td>}
                <td style={{ padding: "8px 12px", color: "#9ca3af", background: ri % 2 ? "#0a1628" : "transparent" }}>{row.implied}</td>
                <td style={{ padding: "8px 12px", color: "#e2e8f0", background: ri % 2 ? "#0a1628" : "transparent" }}>{row.real}</td>
                <td style={{ padding: "8px 12px", color: parseInt(row.edge) > 0 ? "#86efac" : "#f87171", background: ri % 2 ? "#0a1628" : "transparent", fontWeight: 700 }}>{row.edge}</td>
                <td style={{ padding: "8px 12px", color: riskColor(row.risk), background: ri % 2 ? "#0a1628" : "transparent" }}>{row.risk}</td>
                <td style={{ padding: "8px 12px", color: verdictColor(row.verdict), background: ri % 2 ? "#0a1628" : "transparent", fontSize: 16, textAlign: "center" }}>{row.verdict}</td>
                <td style={{ padding: "8px 12px", color: "#9ca3af", background: ri % 2 ? "#0a1628" : "transparent", fontSize: 11 }}>{row.reason}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={hasLiveOdds ? 8 : 7} style={{ padding: "6px 12px", background: "#0a0f1a", fontFamily: "monospace", fontSize: 10, color: "#3b82f6", letterSpacing: 2, fontWeight: 700 }}>
                DOUBLE CHANCE
              </td>
            </tr>
            {rows.filter(r => r.group === "dc").map((row, ri) => (
              <tr key={`dc-${ri}`} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "8px 12px", color: "#f9fafb", background: ri % 2 ? "#0a1628" : "transparent", whiteSpace: "nowrap", fontWeight: 600 }}>{row.market}</td>
                {hasLiveOdds && <td style={{ padding: "8px 12px", color: row.caesars ? "#fbbf24" : "#374151", background: ri % 2 ? "#0a1628" : "transparent", fontWeight: 700 }}>{row.caesars ?? "—"}</td>}
                <td style={{ padding: "8px 12px", color: "#9ca3af", background: ri % 2 ? "#0a1628" : "transparent" }}>{row.implied}</td>
                <td style={{ padding: "8px 12px", color: "#e2e8f0", background: ri % 2 ? "#0a1628" : "transparent" }}>{row.real}</td>
                <td style={{ padding: "8px 12px", color: parseInt(row.edge) > 0 ? "#86efac" : "#f87171", background: ri % 2 ? "#0a1628" : "transparent", fontWeight: 700 }}>{row.edge}</td>
                <td style={{ padding: "8px 12px", color: riskColor(row.risk), background: ri % 2 ? "#0a1628" : "transparent" }}>{row.risk}</td>
                <td style={{ padding: "8px 12px", color: verdictColor(row.verdict), background: ri % 2 ? "#0a1628" : "transparent", fontSize: 16, textAlign: "center" }}>{row.verdict}</td>
                <td style={{ padding: "8px 12px", color: "#9ca3af", background: ri % 2 ? "#0a1628" : "transparent", fontSize: 11 }}>{row.reason}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={hasLiveOdds ? 8 : 7} style={{ padding: "6px 12px", background: "#0a0f1a", fontFamily: "monospace", fontSize: 10, color: "#3b82f6", letterSpacing: 2, fontWeight: 700 }}>
                MATCH RESULT & BOTH TEAMS TO SCORE
              </td>
            </tr>
            {rows.filter(r => r.group === "btts_result").map((row, ri) => (
              <tr key={`btts-${ri}`} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "8px 12px", color: "#f9fafb", background: ri % 2 ? "#0a1628" : "transparent", whiteSpace: "nowrap", fontWeight: 600 }}>{row.market}</td>
                {hasLiveOdds && <td style={{ padding: "8px 12px", color: row.caesars ? "#fbbf24" : "#374151", background: ri % 2 ? "#0a1628" : "transparent", fontWeight: 700 }}>{row.caesars ?? "—"}</td>}
                <td style={{ padding: "8px 12px", color: "#9ca3af", background: ri % 2 ? "#0a1628" : "transparent" }}>{row.implied}</td>
                <td style={{ padding: "8px 12px", color: "#e2e8f0", background: ri % 2 ? "#0a1628" : "transparent" }}>{row.real}</td>
                <td style={{ padding: "8px 12px", color: parseInt(row.edge) > 0 ? "#86efac" : "#f87171", background: ri % 2 ? "#0a1628" : "transparent", fontWeight: 700 }}>{row.edge}</td>
                <td style={{ padding: "8px 12px", color: riskColor(row.risk), background: ri % 2 ? "#0a1628" : "transparent" }}>{row.risk}</td>
                <td style={{ padding: "8px 12px", color: verdictColor(row.verdict), background: ri % 2 ? "#0a1628" : "transparent", fontSize: 16, textAlign: "center" }}>{row.verdict}</td>
                <td style={{ padding: "8px 12px", color: "#9ca3af", background: ri % 2 ? "#0a1628" : "transparent", fontSize: 11 }}>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "14px 16px" }}>
          <SectionLabel>Form Analysis (Last {summary.lastX})</SectionLabel>
          {[summary.formA, summary.formB].map((f, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", marginBottom: i === 0 ? 10 : 0 }}>
              <span style={{ fontFamily: "monospace", fontSize: 10, color: i === 0 ? "#86efac" : "#f87171", marginBottom: 3 }}>{f.team}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: f.pts === null ? "#4b5563" : "#e2e8f0", fontStyle: f.pts === null ? "italic" : "normal" }}>{f.text}</span>
            </div>
          ))}
        </div>

        <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "14px 16px" }}>
          <SectionLabel>Win Probability</SectionLabel>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#e2e8f0", marginBottom: 12 }}>{summary.probLine}</div>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ flex: summary.realA, background: "#166534" }} />
            <div style={{ flex: summary.realD, background: "#1e3a5f" }} />
            <div style={{ flex: summary.realB, background: "#7f1d1d" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 9, marginTop: 4 }}>
            <span style={{ color: "#86efac" }}>{match.teamA}</span>
            <span style={{ color: "#6b7280" }}>Draw</span>
            <span style={{ color: "#f87171" }}>{match.teamB}</span>
          </div>
        </div>
      </div>

      <BookmakerConsensus match={match} summary={summary} />

      <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
        <SectionLabel>Key Factors</SectionLabel>
        {summary.keyFactors.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: i < summary.keyFactors.length - 1 ? 6 : 0 }}>
            <span style={{ color: "#3b82f6", fontFamily: "monospace", fontSize: 12, marginTop: 1, flexShrink: 0 }}>›</span>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>{f}</span>
          </div>
        ))}
      </div>

      <div style={{ background: !summary.liveOdds ? "#0f1a2e" : summary.valueBets.filter(b => b.caesars).length > 0 ? "#052e16" : "#1c0a0a", border: `1px solid ${!summary.liveOdds ? "#1e3a5f" : summary.valueBets.filter(b => b.caesars).length > 0 ? "#166534" : "#7f1d1d"}`, borderRadius: 8, padding: "14px 16px" }}>
        <SectionLabel>Recommendation</SectionLabel>
        {!summary.liveOdds ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#fbbf24" }}>
              ⚠ No live Caesars odds found for this match.
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#4b5563", lineHeight: 1.6 }}>
              Recommendations are disabled without real market odds — comparing a model estimate against a guessed margin produces unreliable results.<br/>
              To get recommendations, make sure the league name matches a supported competition (e.g. "La Liga", "Premier League", "Serie A") and the match is upcoming on Caesars.
            </div>
          </div>
        ) : (() => {
          const liveBets = summary.valueBets.filter(b => b.caesars);
          return liveBets.length > 0 ? (
            <>
              {liveBets.map((b, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < liveBets.length - 1 ? 8 : 0, flexWrap: "wrap" }}>
                  <span style={{ color: "#86efac", fontSize: 14 }}>✓</span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, color: "#f9fafb", fontWeight: 600 }}>{b.market}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#86efac", background: "#166534", padding: "2px 8px", borderRadius: 4 }}>{b.edge} edge</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: riskColor(b.risk) }}>{b.risk} risk</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#fbbf24" }}>Caesars: {b.caesars}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 11, color: "#4b5563", borderTop: "1px solid #1a2e1a", paddingTop: 8 }}>
                Based on live Caesars odds. Suggested stake: 1–2% of bankroll per selection. Never chase losses.
              </div>
            </>
          ) : (
            <div style={{ fontFamily: "monospace", fontSize: 13, color: "#f87171" }}>
              Live Caesars odds loaded but no value edge found — the market is efficiently priced on this match.
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function ParlayCalculator({ results }) {
  // picks: { "matchIdx-parlayKey": { matchIdx, key, decimalOdds, market, matchLabel } }
  const [picks, setPicks] = useState({});
  const [stake, setStake] = useState("5");

  const pickId = (idx, key) => `${idx}-${key}`;

  const toggle = (idx, key, decimalOdds, market, matchLabel) => {
    const id = pickId(idx, key);
    setPicks(p => {
      if (p[id]) { const next = { ...p }; delete next[id]; return next; }
      return { ...p, [id]: { matchIdx: idx, key, decimalOdds, market, matchLabel } };
    });
  };

  const selectedPicks = Object.values(picks);
  const combinedDecimal = selectedPicks.reduce((acc, v) => acc * v.decimalOdds, 1);
  const stakeNum = parseFloat(stake) || 0;
  const payout = stakeNum * combinedDecimal;
  const profit = payout - stakeNum;
  const combinedAmerican = combinedDecimal >= 2 ? `+${Math.round((combinedDecimal - 1) * 100)}` : `${Math.round(-100 / (combinedDecimal - 1))}`;

  const btnStyle = (active) => ({
    background: active ? "#166534" : "#0a1628",
    border: `1px solid ${active ? "#86efac" : "#1e3a5f"}`,
    borderRadius: 6,
    padding: "6px 12px",
    color: active ? "#86efac" : "#6b7280",
    fontFamily: "monospace",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 12, padding: "22px", marginBottom: 20 }}>
      <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 3, color: "#fbbf24", marginBottom: 4, textTransform: "uppercase", fontWeight: 700 }}>Parlay / Multi-Bet Builder</div>
      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#4b5563", marginBottom: 16 }}>Select any combination of bets across matches — e.g. BTTS + Team Win on the same game</div>

      {results.map(({ match, analysis }, idx) => {
        const { parlayOdds } = analysis;
        const pickableRows = analysis.rows.filter(r => r.parlayKey && parlayOdds[r.parlayKey]);
        const matchLabel = `${match.teamA} vs ${match.teamB}`;
        return (
          <div key={idx} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #1e293b" }}>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
              {matchLabel} <span style={{ color: "#4b5563" }}>· {match.league}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {pickableRows.map((row) => {
                const odds = parlayOdds[row.parlayKey];
                const isActive = !!picks[pickId(idx, row.parlayKey)];
                return (
                  <button key={row.parlayKey} onClick={() => toggle(idx, row.parlayKey, odds, row.market, matchLabel)} style={btnStyle(isActive)}>
                    {row.market}
                    <span style={{ color: isActive ? "#86efac" : "#374151", marginLeft: 6 }}>
                      {decimalToAmerican(odds)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>STAKE $</span>
          <input
            type="number"
            value={stake}
            onChange={e => setStake(e.target.value)}
            min="0"
            step="1"
            style={{ width: 80, background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, padding: "6px 10px", color: "#f9fafb", fontFamily: "monospace", fontSize: 13, outline: "none" }}
          />
        </div>
        {selectedPicks.length >= 1 && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "monospace", fontSize: 11 }}>
              <span style={{ color: "#6b7280" }}>Legs: </span>
              <span style={{ color: "#f9fafb" }}>{selectedPicks.length}</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11 }}>
              <span style={{ color: "#6b7280" }}>Combined odds: </span>
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>{combinedAmerican}</span>
              <span style={{ color: "#4b5563" }}> ({combinedDecimal.toFixed(2)}x)</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11 }}>
              <span style={{ color: "#6b7280" }}>Payout: </span>
              <span style={{ color: "#86efac", fontWeight: 700 }}>${payout.toFixed(2)}</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11 }}>
              <span style={{ color: "#6b7280" }}>Profit: </span>
              <span style={{ color: "#86efac", fontWeight: 700 }}>+${profit.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {selectedPicks.length >= 1 && (
        <div style={{ marginTop: 14, background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#3b82f6", letterSpacing: 2, marginBottom: 8 }}>SELECTED PICKS ({selectedPicks.length} leg{selectedPicks.length !== 1 ? "s" : ""})</div>
          {selectedPicks.map((pick, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
              <span>{pick.matchLabel} — <span style={{ color: "#f9fafb" }}>{pick.market}</span></span>
              <span style={{ color: "#fbbf24" }}>{decimalToAmerican(pick.decimalOdds)}</span>
            </div>
          ))}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1e293b", display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
            <span style={{ color: "#6b7280" }}>Stake ${stakeNum.toFixed(2)} → Total Payout</span>
            <span style={{ color: "#86efac" }}>${payout.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 10, color: "#374151" }}>
        Odds shown are Caesars live lines where available, otherwise model estimates. Parlay odds multiply automatically.
      </div>
    </div>
  );
}

export default function App() {
  const [matches, setMatches] = useState([emptyMatch()]);
  const [lastX, setLastX] = useState(5);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const addMatch = () => setMatches(m => [...m, emptyMatch()]);
  const removeMatch = (i) => setMatches(m => m.filter((_, idx) => idx !== i));
  const updateMatch = (i, key, val) => setMatches(m => m.map((x, idx) => idx === i ? { ...x, [key]: val } : x));

  const analyze = async () => {
    const valid = matches.filter(m => m.teamA && m.teamB && m.league && m.date);
    if (!valid.length) { setError("Fill in at least one complete match (Home, Away, League, Date)."); return; }
    setError("");
    setLoading(true);
    const generated = await Promise.all(
      valid.map(async (m) => {
        const liveOdds = await fetchLiveOdds(m);
        return { match: m, analysis: generateAnalysis(m, lastX, liveOdds) };
      })
    );
    setResults(generated);
    setLoading(false);
  };

  const validCount = matches.filter(m => m.teamA && m.teamB).length;

  return (
    <div style={{ minHeight: "100vh", background: "#030712", color: "#f9fafb", padding: "36px 20px" }}>
      <style>{`* { box-sizing: border-box; } input:focus { border-color: #3b82f6 !important; outline: none !important; } input::placeholder { color: #374151; } input[type=number]::-webkit-inner-spin-button { opacity: 1; }`}</style>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-block", background: "#052e16", border: "1px solid #166534", borderRadius: 20, padding: "4px 16px", fontFamily: "monospace", fontSize: 10, color: "#86efac", letterSpacing: 3, marginBottom: 12 }}>MULTI-MATCH · CAESARS LIVE ODDS · PARLAY BUILDER</div>
          <h1 style={{ fontSize: 36, fontWeight: 700, margin: "0 0 8px", fontFamily: "Georgia, serif" }}>Betting Analyst</h1>
          <p style={{ color: "#6b7280", fontSize: 13, margin: 0, fontFamily: "monospace" }}>Enter match data · Fetch live Caesars odds · Build parlays</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6b7280", letterSpacing: 1 }}>FORM WINDOW:</span>
          {[3, 5, 10].map(n => (
            <button key={n} onClick={() => setLastX(n)} style={{ background: lastX === n ? "#166534" : "transparent", border: `1px solid ${lastX === n ? "#86efac" : "#374151"}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", color: lastX === n ? "#86efac" : "#6b7280", fontFamily: "monospace", fontSize: 12 }}>Last {n}</button>
          ))}
        </div>

        {matches.map((m, i) => (
          <MatchCard key={i} match={m} index={i} onChange={updateMatch} onRemove={removeMatch} total={matches.length} lastX={lastX} />
        ))}

        {error && <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontFamily: "monospace", fontSize: 12, marginBottom: 12 }}>⚠ {error}</div>}

        <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
          <button onClick={addMatch} style={{ background: "transparent", border: "1px dashed #374151", borderRadius: 8, padding: "10px 18px", color: "#9ca3af", fontFamily: "monospace", fontSize: 12, cursor: "pointer", letterSpacing: 1 }}>+ Add Match</button>
          <button onClick={analyze} disabled={loading} style={{ flex: 1, minWidth: 140, background: loading ? "#1a2e1a" : "#166534", border: "1px solid #86efac", borderRadius: 8, padding: "10px 20px", color: "#86efac", fontFamily: "monospace", fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer", letterSpacing: 2 }}>
            {loading ? "FETCHING LIVE ODDS..." : `▶ ANALYSE ${validCount} MATCH${validCount !== 1 ? "ES" : ""}`}
          </button>
        </div>

        {results.map(({ match, analysis }, si) => (
          <MatchResult key={si} match={match} analysis={analysis} index={si} />
        ))}

        {results.length > 0 && <ParlayCalculator results={results} />}

        <div style={{ marginTop: 32, textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "#1f2937", letterSpacing: 1 }}>
          ⚠ FOR INFORMATIONAL PURPOSES ONLY · NO GUARANTEED WINS · GAMBLE RESPONSIBLY · 18+
        </div>
      </div>
    </div>
  );
}
