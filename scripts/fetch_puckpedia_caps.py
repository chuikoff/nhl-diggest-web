#!/usr/bin/env python3
"""Scrape public PuckPedia HTML into assets/cap-hits.json for the Mini App.

Source: https://puckpedia.com (homepage team summary + /team/{slug} roster tables).
No private API key. Re-run periodically — numbers change with signings/trades/LTIR.

Usage (from repo root):
  python3 scripts/fetch_puckpedia_caps.py
  python3 scripts/fetch_puckpedia_caps.py --out assets/cap-hits.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

UA = "NHLDiggestCapBot/1.0 (+https://github.com/chuikoff/nhl-diggest-web; personal mini-app)"
HOME = "https://puckpedia.com/"
TEAM_URL = "https://puckpedia.com/team/{slug}"

# Homepage lists all 32; keep as fallback order if discovery fails.
TEAM_SLUGS = [
    "anaheim-ducks", "boston-bruins", "buffalo-sabres", "calgary-flames",
    "carolina-hurricanes", "chicago-blackhawks", "colorado-avalanche",
    "columbus-blue-jackets", "dallas-stars", "detroit-red-wings",
    "edmonton-oilers", "florida-panthers", "los-angeles-kings",
    "minnesota-wild", "montreal-canadiens", "nashville-predators",
    "new-jersey-devils", "new-york-islanders", "new-york-rangers",
    "ottawa-senators", "philadelphia-flyers", "pittsburgh-penguins",
    "san-jose-sharks", "seattle-kraken", "st-louis-blues",
    "tampa-bay-lightning", "toronto-maple-leafs", "utah-mammoth",
    "vancouver-canucks", "vegas-golden-knights", "washington-capitals",
    "winnipeg-jets",
]


def fetch(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def parse_int_money(raw: str) -> int | None:
    s = raw.strip().replace(",", "").replace("$", "")
    if not s:
        return None
    try:
        return int(round(float(s)))
    except ValueError:
        return None


def parse_abbrev_money(value: str, unit: str) -> int | None:
    try:
        n = float(value)
    except ValueError:
        return None
    u = unit.upper()
    if u == "M":
        n *= 1_000_000
    elif u == "K":
        n *= 1_000
    return int(round(n))


def parse_home_teams(html: str) -> dict[str, dict]:
    """abbrev -> {slug, projectedCapHit, projectedSpace, currentSpace} from homepage table."""
    teams: dict[str, dict] = {}
    parts = re.split(r'href="/team/([a-z0-9-]+)"', html)
    for i in range(1, len(parts), 2):
        slug = parts[i]
        chunk = parts[i + 1][:3000]
        am = re.search(r">\s*([A-Z]{2,3})\s*<", chunk)
        if not am:
            continue
        abbrev = am.group(1)
        if abbrev in teams:
            continue
        moneys: list[int] = []
        for v, u in re.findall(
            r"\$([\d.]+)<span class='pp_currency_abbrev'>([KM])", chunk
        )[:3]:
            n = parse_abbrev_money(v, u)
            if n is not None:
                moneys.append(n)
        if len(moneys) < 1:
            continue
        teams[abbrev] = {
            "slug": slug,
            "abbrev": abbrev,
            "projectedCapHit": moneys[0] if len(moneys) > 0 else None,
            "projectedSpace": moneys[1] if len(moneys) > 1 else None,
            "currentSpace": moneys[2] if len(moneys) > 2 else None,
        }
    return teams


def parse_team_summary(html: str) -> dict:
    """Exact projected hit/space from team page prose / labeled vals when present."""
    out: dict = {}
    m = re.search(r"projected cap hit of \$([\d,]+)", html, re.I)
    if m:
        out["projectedCapHit"] = parse_int_money(m.group(1))
    m = re.search(r"projected cap space of \$([\d,]+)", html, re.I)
    if m:
        out["projectedSpace"] = parse_int_money(m.group(1))
    # Fallback: first "Projected Cap Hit" popover block's val-lg after the label.
    if "projectedCapHit" not in out:
        m = re.search(
            r'data-title="Projected Cap Hit"[\s\S]{0,1200}?class=\'val-lg\'>(\$[\d,]+)',
            html,
        )
        if m:
            out["projectedCapHit"] = parse_int_money(m.group(1))
    if "projectedSpace" not in out:
        m = re.search(
            r'data-title="Projected Cap Space"[\s\S]{0,1200}?class=\'val-lg\'>(\$[\d,]+)',
            html,
        )
        if m:
            out["projectedSpace"] = parse_int_money(m.group(1))
    return out


def parse_nhl_id_map(html: str) -> dict[str, dict]:
    """url_id -> {nhlId, name} from gearGeekTeamEquipmentBlock embed."""
    m = re.search(r"gearGeekTeamEquipmentBlock\('([^']*)',\s*(\[.*?\])\s*\)", html, re.S)
    if not m:
        return {}
    try:
        arr = json.loads(unescape(m.group(2)))
    except json.JSONDecodeError:
        return {}
    out: dict[str, dict] = {}
    for p in arr:
        slug = p.get("url_id")
        nhl = p.get("nhl_id")
        if not slug or not nhl:
            continue
        out[slug] = {
            "nhlId": str(nhl),
            "name": f"{p.get('first_name', '')} {p.get('last_name', '')}".strip(),
        }
    return out


def display_name(raw: str, fallback: str) -> str:
    name = re.sub(r"\s+", " ", unescape(raw)).strip()
    if "," in name:
        last, first = [x.strip() for x in name.split(",", 1)]
        name = f"{first} {last}".strip()
    return name or fallback


def parse_roster_players(html: str, abbrev: str, id_map: dict[str, dict]) -> list[dict]:
    players: list[dict] = []
    # Roster row: player link (translate=no) then season capcol data-extract_ch.
    pattern = re.compile(
        r'href="/player/([a-z0-9-]+)"[^>]*translate="no">([^<]+)</a>'
        r'[\s\S]{0,14000}?'
        r'data-js="capcol"\s+data-extract_ch="([\d,]+)"',
        re.I,
    )
    for m in pattern.finditer(html):
        slug, raw_name, ch = m.group(1), m.group(2), m.group(3)
        cap_hit = parse_int_money(ch)
        if cap_hit is None:
            continue
        window = html[m.start() : m.start() + 16000]
        status = year = None
        exp = re.search(
            r"pp-(?:ufa|rfa|elc)[^>]*translate='no'>(UFA|RFA|ELC)</span>"
            r"[\s\S]{0,200}?>\s*(20\d{2})\s*<",
            window,
            re.I,
        )
        if exp:
            status, year = exp.group(1).upper(), exp.group(2)
        else:
            exp2 = re.search(
                r"pp-(?:ufa|rfa|elc)[^>]*>\s*(UFA|RFA|ELC)\s*<[\s\S]{0,200}?(20\d{2})",
                window,
                re.I,
            )
            if exp2:
                status, year = exp2.group(1).upper(), exp2.group(2)
        meta = id_map.get(slug, {})
        players.append(
            {
                "slug": slug,
                "name": meta.get("name") or display_name(raw_name, slug),
                "nhlId": meta.get("nhlId"),
                "abbrev": abbrev,
                "capHit": cap_hit,
                "expiryYear": year,
                "expiryStatus": status,
            }
        )
    # Dedupe by slug (page repeats mobile/desktop columns).
    seen: set[str] = set()
    uniq: list[dict] = []
    for p in players:
        if p["slug"] in seen:
            continue
        seen.add(p["slug"])
        uniq.append(p)
    return uniq


def build_payload(delay: float) -> dict:
    print("Fetching homepage…", flush=True)
    home = fetch(HOME)
    home_teams = parse_home_teams(home)
    print(f"  teams on homepage: {len(home_teams)}", flush=True)

    slugs = []
    seen_slug: set[str] = set()
    for t in home_teams.values():
        if t["slug"] not in seen_slug:
            slugs.append(t["slug"])
            seen_slug.add(t["slug"])
    for s in TEAM_SLUGS:
        if s not in seen_slug:
            slugs.append(s)
            seen_slug.add(s)

    teams_out: dict[str, dict] = {}
    players_by_nhl: dict[str, dict] = {}
    players_by_name: dict[str, dict] = {}

    for idx, slug in enumerate(slugs, 1):
        url = TEAM_URL.format(slug=slug)
        print(f"[{idx}/{len(slugs)}] {slug}", flush=True)
        try:
            html = fetch(url)
        except Exception as exc:  # noqa: BLE001
            print(f"  WARN skip: {exc}", flush=True)
            continue
        # Resolve abbrev from homepage map or page
        abbrev = next((a for a, t in home_teams.items() if t["slug"] == slug), None)
        if not abbrev:
            am = re.search(r">\s*([A-Z]{2,3})\s*<", html[0:50000] or "")
            # Prefer schema / title
            tm = re.search(r"currentPath\":\"team\/([a-z0-9-]+)\"", html)
            abbrev = abbrev or (am.group(1) if am else slug[:3].upper())
        summary = parse_team_summary(html)
        base = home_teams.get(abbrev, {"slug": slug, "abbrev": abbrev})
        team_rec = {
            "abbrev": abbrev,
            "slug": slug,
            "capHit": summary.get("projectedCapHit") or base.get("projectedCapHit"),
            "capSpace": summary.get("projectedSpace")
            if summary.get("projectedSpace") is not None
            else base.get("projectedSpace"),
            "currentSpace": base.get("currentSpace"),
            "source": "puckpedia",
            "url": url,
        }
        teams_out[abbrev] = team_rec

        id_map = parse_nhl_id_map(html)
        for p in parse_roster_players(html, abbrev, id_map):
            entry = {
                "nhlId": p.get("nhlId"),
                "name": p["name"],
                "slug": p["slug"],
                "abbrev": abbrev,
                "capHit": p["capHit"],
                "expiryYear": p.get("expiryYear"),
                "expiryStatus": p.get("expiryStatus"),
                "source": "puckpedia",
                "url": f"https://puckpedia.com/player/{p['slug']}",
            }
            if p.get("nhlId"):
                players_by_nhl[str(p["nhlId"])] = entry
            key = re.sub(r"[^a-z0-9]", "", p["name"].lower())
            if key:
                players_by_name[key] = entry

        time.sleep(delay)

    return {
        "source": "puckpedia.com",
        "scrapedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "notes": (
            "Public HTML scrape for Mini App offline asset. "
            "Team capHit/capSpace = PuckPedia projected figures. "
            "Player capHit = current-season roster cap hit; expiry = UFA/RFA year when present. "
            "Refresh: python3 scripts/fetch_puckpedia_caps.py"
        ),
        "teams": teams_out,
        "playersByNhlId": players_by_nhl,
        "playersByName": players_by_name,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets" / "cap-hits.json",
    )
    ap.add_argument("--delay", type=float, default=0.35, help="Pause between team pages")
    args = ap.parse_args()
    payload = build_payload(args.delay)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    n_teams = len(payload["teams"])
    n_players = len(payload["playersByNhlId"])
    print(f"Wrote {args.out} — {n_teams} teams, {n_players} players with nhlId", flush=True)
    if n_teams < 30 or n_players < 500:
        print("WARN: counts look low; check scrape selectors", flush=True)
        return 2
    # Spot-check MIN / Kaprizov
    min_t = payload["teams"].get("MIN")
    kap = payload["playersByNhlId"].get("8478864")
    print("sample MIN team:", min_t, flush=True)
    print("sample Kaprizov:", kap, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
