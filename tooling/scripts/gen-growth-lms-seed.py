#!/usr/bin/env python3
"""Generate supabase/seed/catalog/060_growth_reference_lms.sql (S6-02, 05 section 19 order 6).

SOURCES (official WHO publications, as distributed by the WHO's own GitHub organisation):

  WHO Child Growth Standards 2006, 0 to 1826 days (0 to 60 months), daily LMS ("expanded tables"):
    https://raw.githubusercontent.com/WorldHealthOrganization/anthro/master/data-raw/growthstandards/
      weianthro.txt  weight-for-age            -> indicator wfa
      lenanthro.txt  length/height-for-age     -> indicator lhfa (column loh: L = recumbent length below
                                                  731 days, H = standing height from 731 days)
      bmianthro.txt  BMI-for-age               -> indicator bmifa (loh as above)
      hcanthro.txt   head circumference-for-age -> indicator hcfa
    Columns: sex (1 = male, 2 = female), age (days), l, m, s. These are the tables the WHO Anthro
    software and the WHO R package use; WHO recommends day-based lookup below 5 years.

  WHO Growth Reference 2007, 61 to 228 months, monthly LMS:
    https://raw.githubusercontent.com/WorldHealthOrganization/anthroplus/master/R/sysdata.rda
      wfa_growth_standards (61 to 120 months), hfa_growth_standards and bfa_growth_standards
      (61 to 228 months). The R data file also carries a 60-month row and a padding row past the last
      month (121 and 229, repeating the last values for interpolation); both are dropped here.
    Reading .rda needs the Python package `rdata` (pip install rdata).

  CDC 2000 (2 to 20 years): NOT SEEDED. The official CDC files (https://www.cdc.gov/growthcharts/
  percentile_data_files.htm: wtage.csv, statage.csv, bmiage.csv) could not be downloaded from the build
  container. TODO(S6-02, CDC): download them from cdc.gov, add their sha256 to supabase/seed/checksums.txt,
  and pass --cdc-dir to this script (Sex 1 = male, 2 = female; Agemos is in half months; age 24 to 240).
  CDC is only used for households that opt in (06 section 4.8, US Phase 2), so nothing in MVP needs it.

Mapping to public.growth_reference_lms: reference who_2006 rows carry age_days (exact table key) and
age_months = round(age_days / 30.4375, 2); who_2007 rows carry integer age_months and age_days null.
Values are copied as published (no smoothing, no interpolation). Every input file is checked against
supabase/seed/checksums.txt before anything is written.

Usage:
  python3 tooling/scripts/gen-growth-lms-seed.py --fetch            # download to a temp dir, then generate
  python3 tooling/scripts/gen-growth-lms-seed.py --src DIR          # DIR holds the five files above
  python3 tooling/scripts/gen-growth-lms-seed.py --src DIR --cdc-dir CDCDIR
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "supabase/seed/catalog/060_growth_reference_lms.sql"
CHECKSUMS = ROOT / "supabase/seed/checksums.txt"

WHO_2006 = {
    "weianthro.txt": "wfa",
    "lenanthro.txt": "lhfa",
    "bmianthro.txt": "bmifa",
    "hcanthro.txt": "hcfa",
}
WHO_2006_URL = "https://raw.githubusercontent.com/WorldHealthOrganization/anthro/master/data-raw/growthstandards/"
WHO_2007_FILE = "sysdata.rda"
WHO_2007_URL = "https://raw.githubusercontent.com/WorldHealthOrganization/anthroplus/master/R/sysdata.rda"
WHO_2007 = {  # R object -> (indicator, first month, last month)
    "wfa_growth_standards": ("wfa", 61, 120),
    "hfa_growth_standards": ("lhfa", 61, 228),
    "bfa_growth_standards": ("bmifa", 61, 228),
}
CDC = {"wtage.csv": "wfa", "statage.csv": "lhfa", "bmiage.csv": "bmifa"}
DAYS_PER_MONTH = 30.4375
SEX = {"1": "male", "2": "female"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_checksums() -> dict[str, str]:
    out = {}
    for line in CHECKSUMS.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            digest, name = line.split(None, 1)
            out[name.strip()] = digest
    return out


def verify(path: Path, key: str, sums: dict[str, str]) -> None:
    want = sums.get(key)
    got = sha256(path)
    if want is None:
        sys.exit(f"no checksum for {key} in {CHECKSUMS}; add '{got}  {key}' after checking the source")
    if want != got:
        sys.exit(f"checksum mismatch for {key}: expected {want}, got {got}")


def num(v: str | float) -> str:
    s = f"{float(v):.6f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def who_2006_rows(src: Path, sums: dict[str, str]):
    for fname, indicator in WHO_2006.items():
        path = src / fname
        verify(path, f"who_2006/{fname}", sums)
        with path.open(newline="") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                days = int(r["age"])
                yield ("who_2006", indicator, SEX[r["sex"]], f"{days / DAYS_PER_MONTH:.2f}", str(days),
                       num(r["l"]), num(r["m"]), num(r["s"]))


def who_2007_rows(src: Path, sums: dict[str, str]):
    path = src / WHO_2007_FILE
    verify(path, f"who_2007/{WHO_2007_FILE}", sums)
    try:
        import rdata  # type: ignore
    except ImportError:
        sys.exit("reading the WHO 2007 .rda needs `pip install rdata`")
    data = rdata.read_rda(str(path))
    for obj, (indicator, lo, hi) in WHO_2007.items():
        df = data[obj]
        for _, r in df.iterrows():
            age = int(r["age"])
            if lo <= age <= hi:
                yield ("who_2007", indicator, SEX[str(int(r["sex"]))], f"{age:.2f}", None,
                       num(r["l"]), num(r["m"]), num(r["s"]))


def cdc_rows(src: Path, sums: dict[str, str]):
    for fname, indicator in CDC.items():
        path = src / fname
        verify(path, f"cdc_2000/{fname}", sums)
        with path.open(newline="") as fh:
            for r in csv.DictReader(fh):
                if r.get("Sex") not in SEX:  # the CDC files repeat their header mid-file
                    continue
                yield ("cdc_2000", indicator, SEX[r["Sex"]], f"{float(r['Agemos']):.2f}", None,
                       num(r["L"]), num(r["M"]), num(r["S"]))


def fetch(dst: Path) -> None:
    for fname in WHO_2006:
        urllib.request.urlretrieve(WHO_2006_URL + fname, dst / fname)
    urllib.request.urlretrieve(WHO_2007_URL, dst / WHO_2007_FILE)


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--src", type=Path)
    g.add_argument("--fetch", action="store_true")
    ap.add_argument("--cdc-dir", type=Path)
    args = ap.parse_args()
    sums = load_checksums()

    with tempfile.TemporaryDirectory() as tmp:
        src = args.src
        if args.fetch:
            src = Path(tmp)
            fetch(src)
        rows = list(who_2006_rows(src, sums)) + list(who_2007_rows(src, sums))
        if args.cdc_dir:
            rows += list(cdc_rows(args.cdc_dir, sums))

    keys = {(r[0], r[1], r[2], r[3]) for r in rows}
    if len(keys) != len(rows):
        sys.exit("duplicate (reference, indicator, sex, age_months) keys")
    counts: dict[str, int] = {}
    for r in rows:
        counts[r[0]] = counts.get(r[0], 0) + 1

    lines = [
        "-- supabase/seed/catalog/060_growth_reference_lms.sql",
        "-- GENERATED by tooling/scripts/gen-growth-lms-seed.py. Do not edit by hand; read the script docstring.",
        "-- Growth reference LMS tables (S6-02, 05 section 12.6 and 19 order 6). Idempotent: on conflict do nothing.",
        "--   who_2006  WHO Child Growth Standards, daily 0 to 1826 days (wfa, lhfa, bmifa, hcfa), from",
        "--             github.com/WorldHealthOrganization/anthro data-raw/growthstandards",
        "--   who_2007  WHO Growth Reference 5-19 y, monthly 61 to 228 months (wfa to 120), from",
        "--             github.com/WorldHealthOrganization/anthroplus R/sysdata.rda",
        "--   cdc_2000  NOT SEEDED: cdc.gov was unreachable from the build container (TODO in the script).",
        "-- Source files are pinned by sha256 in supabase/seed/checksums.txt. Values are as published.",
        "-- PENDING: clinical sign-off of the growth-compute thresholds that read these rows (S6-03).",
        "-- Row counts: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + f", total {len(rows)}.",
        "",
        "insert into public.growth_reference_lms (reference, indicator, sex, age_months, age_days, l, m, s)",
        "select v.reference, v.indicator, v.sex::public.sex_at_birth, v.age_months, v.age_days, v.l, v.m, v.s",
        "from (values",
    ]
    body = []
    for i, (ref, ind, sex, age_m, age_d, l, m, s) in enumerate(rows):
        age_d_sql = age_d if age_d is not None else "null::integer"
        if i == 0:
            body.append(f"  ('{ref}', '{ind}', '{sex}', {age_m}::numeric, {age_d_sql}::integer, "
                        f"{l}::numeric, {m}::numeric, {s}::numeric)")
        else:
            body.append(f"  ('{ref}', '{ind}', '{sex}', {age_m}, {age_d_sql if age_d is not None else 'null'}, {l}, {m}, {s})")
    lines.append(",\n".join(body))
    lines.append(") as v(reference, indicator, sex, age_months, age_days, l, m, s)")
    lines.append("on conflict (reference, indicator, sex, age_months) do nothing;")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} rows {counts}")


if __name__ == "__main__":
    main()
