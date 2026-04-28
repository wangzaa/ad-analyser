# Hashtag-Driven Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a config-driven Python script that scrapes 28 Instagram hashtags via Apify, drills into top-engaged posts for comments, and emits flattened CSVs + manifest for qualitative review.

**Architecture:** Single Python script (`apify_hashtag_test.py`) with three concerns separated: scrape orchestration (network I/O), flattening (pure functions, raw dicts → CSV rows), and serialisation (CSV + JSON writers). Pure functions are unit-tested. Network code is integration-tested with `--from-raw` re-flatten mode.

**Tech Stack:** Python 3.10+, stdlib only (`urllib`, `csv`, `json`, `argparse`, `pathlib`), `pytest` for tests. No third-party packages required at runtime — matches existing `apify_test.py` zero-dep pattern.

**Spec:** [`docs/superpowers/specs/2026-04-28-hashtag-driven-test-design.md`](../specs/2026-04-28-hashtag-driven-test-design.md)

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `apify_test.py` | rename → `apify_brand_probe.py` | Existing brand-handle probe, archived under new name |
| `apify_hashtag_test.py` | create | Hashtag-driven test orchestrator + flattening + writers |
| `hashtags.json` | create | Config: hashtag list, sample sizes, cost cap |
| `tests/test_apify_hashtag_test.py` | create | Unit tests for pure functions (`estimate_cost`, `flatten_posts`, `flatten_comments`, `aggregate_kols`, `write_csv`) |
| `tests/conftest.py` | create | pytest path setup so tests can import `apify_hashtag_test` from project root |
| `.gitignore` | modify | Ignore `apify_output/` and `apify_test_output/` |
| `README.md` | modify | Add "Hashtag Test" section under existing dashboard docs |

`apify_hashtag_test.py` is one file because the pure functions are small and tightly coupled to a single workflow. If the script grows past ~600 lines, split flattening into a sibling module — but premature splitting buys nothing now.

---

## Task 1: Rename existing probe and update gitignore

**Files:**
- Rename: `apify_test.py` → `apify_brand_probe.py`
- Modify: `.gitignore`

- [ ] **Step 1: Check `apify_test.py` git state**

Run: `git status apify_test.py`
Expected: shows the file as either tracked (modified/unmodified) OR untracked (`??`). The repo state has it untracked.

- [ ] **Step 2: Rename the file**

If the file is untracked, use plain `mv`:

```bash
mv apify_test.py apify_brand_probe.py
```

If tracked, use `git mv apify_test.py apify_brand_probe.py` instead.

Expected: no output on success.

- [ ] **Step 3: Update the docstring in the renamed file**

Open `apify_brand_probe.py` and replace the top docstring:

```python
#!/usr/bin/env python3
"""
Apify IG brand-handle probe — small validation of HK telco brand profiles.

Archived from the original apify_test.py. Kept runnable for re-validation.
For hashtag-driven scraping, see apify_hashtag_test.py.

Usage:
    export APIFY_TOKEN=apify_api_xxxx
    python apify_brand_probe.py
"""
```

Leave the rest of the file unchanged.

- [ ] **Step 4: Update `.gitignore`**

Open `.gitignore` and append:

```
apify_output/
apify_test_output/
```

After editing, the file reads:

```
node_modules/
.env
.DS_Store
*.log
rednote.har
apify_output/
apify_test_output/
```

- [ ] **Step 5: Commit**

```bash
git add apify_brand_probe.py .gitignore
git commit -m "refactor: rename apify_test.py to apify_brand_probe.py, ignore output dirs"
```

---

## Task 2: Write `hashtags.json` config

**Files:**
- Create: `hashtags.json`

- [ ] **Step 1: Create the config file**

Create `hashtags.json` with exactly this content:

```json
{
  "run_label": "segments_4_5_6_test",
  "results_per_hashtag": 30,
  "top_n_posts_for_comments": 5,
  "comments_per_top_post": 10,
  "max_estimated_cost_usd": 2.00,
  "hashtags": [
    { "tag": "手遊",          "segment": "gamer_tech" },
    { "tag": "香港手遊",      "segment": "gamer_tech" },
    { "tag": "電競",          "segment": "gamer_tech" },
    { "tag": "5g",            "segment": "gamer_tech" },
    { "tag": "5gnetwork",     "segment": "gamer_tech" },
    { "tag": "香港5g",        "segment": "gamer_tech" },
    { "tag": "gameplayhk",    "segment": "gamer_tech" },
    { "tag": "手機評測",      "segment": "gamer_tech" },
    { "tag": "速度測試",      "segment": "gamer_tech" },
    { "tag": "網速",          "segment": "gamer_tech" },
    { "tag": "港大",          "segment": "student_youth" },
    { "tag": "中大",          "segment": "student_youth" },
    { "tag": "科大",          "segment": "student_youth" },
    { "tag": "dse",           "segment": "student_youth" },
    { "tag": "hkuni",         "segment": "student_youth" },
    { "tag": "exchangestudent","segment": "student_youth" },
    { "tag": "freshyear",     "segment": "student_youth" },
    { "tag": "迎新",          "segment": "student_youth" },
    { "tag": "上台優惠",      "segment": "telco_value" },
    { "tag": "轉台",          "segment": "telco_value" },
    { "tag": "手機計劃",      "segment": "telco_value" },
    { "tag": "寬頻",          "segment": "telco_value" },
    { "tag": "5g家居寬頻",    "segment": "telco_value" },
    { "tag": "家居寬頻",      "segment": "telco_value" },
    { "tag": "hkbroadband",   "segment": "telco_value" },
    { "tag": "sim卡",         "segment": "telco_value" },
    { "tag": "月費",          "segment": "telco_value" },
    { "tag": "平價計劃",      "segment": "telco_value" }
  ]
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `python3 -c "import json; print(len(json.load(open('hashtags.json'))['hashtags']))"`
Expected: `28`

- [ ] **Step 3: Commit**

```bash
git add hashtags.json
git commit -m "config: add hashtags.json for segments 4/5/6 IG scrape"
```

---

## Task 3: Test scaffolding and skeleton script

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_apify_hashtag_test.py`
- Create: `apify_hashtag_test.py`

- [ ] **Step 1: Create `tests/conftest.py`**

```python
"""Allow tests to import apify_hashtag_test from project root."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

- [ ] **Step 2: Create the skeleton script**

Create `apify_hashtag_test.py` with:

```python
#!/usr/bin/env python3
"""
Apify IG hashtag-driven test — segment 4/5/6 probe.

Reads hashtags.json, scrapes posts + comments via Apify, writes CSVs +
manifest to apify_output/<timestamp>_<run_label>/.

Usage:
    export APIFY_TOKEN=apify_api_xxxx
    python apify_hashtag_test.py [--config PATH] [--force] [--from-raw DIR]
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# ─── Constants ─────────────────────────────────────────────────
COST_PER_POST = 0.001       # USD, Apify hashtag scraper estimate
COST_PER_COMMENT = 0.0002   # USD, Apify comment scraper estimate

API_BASE = "https://api.apify.com/v2"
HASHTAG_ACTOR = "apify/instagram-hashtag-scraper"
COMMENT_ACTOR = "apify/instagram-comment-scraper"

POSTS_COLUMNS = [
    "hashtag", "segment", "post_id", "shortcode", "url",
    "owner_username", "owner_full_name", "caption",
    "likes_count", "comments_count", "timestamp", "is_top_engaged",
]

COMMENTS_COLUMNS = [
    "hashtag", "segment", "post_id", "post_url", "post_owner_username",
    "comment_id", "comment_owner_username", "text",
    "likes_count", "timestamp",
]

KOLS_COLUMNS = [
    "username", "appearances", "hashtags", "segments",
    "total_likes", "total_comments", "top_post_url",
]


def load_dotenv_if_present(path=".env"):
    """If APIFY_TOKEN is not already in os.environ, parse path for KEY=value
    lines and set them. Stdlib only, no python-dotenv dependency.

    Lines beginning with '#' or blank lines are ignored. Quoted values
    have surrounding quotes stripped. Existing env vars are NOT overwritten.
    """
    if os.environ.get("APIFY_TOKEN"):
        return
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
```

(More functions added in subsequent tasks. Leave the file at this point for now.)

- [ ] **Step 3: Create empty test file**

Create `tests/test_apify_hashtag_test.py` with:

```python
"""Unit tests for apify_hashtag_test pure functions."""
import os
import apify_hashtag_test as M


def test_module_imports():
    assert M.COST_PER_POST == 0.001
    assert M.COST_PER_COMMENT == 0.0002
    assert M.HASHTAG_ACTOR == "apify/instagram-hashtag-scraper"


def test_load_dotenv_sets_missing_var(tmp_path, monkeypatch):
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text('APIFY_TOKEN=xyz123\n# comment\nOTHER="quoted"\n')
    M.load_dotenv_if_present(str(env_file))
    assert os.environ["APIFY_TOKEN"] == "xyz123"
    assert os.environ["OTHER"] == "quoted"


def test_load_dotenv_does_not_overwrite_existing(tmp_path, monkeypatch):
    monkeypatch.setenv("APIFY_TOKEN", "already_set")
    env_file = tmp_path / ".env"
    env_file.write_text("APIFY_TOKEN=should_be_ignored\n")
    M.load_dotenv_if_present(str(env_file))
    assert os.environ["APIFY_TOKEN"] == "already_set"


def test_load_dotenv_silent_when_missing_file(tmp_path, monkeypatch):
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    M.load_dotenv_if_present(str(tmp_path / "nonexistent.env"))
    assert os.environ.get("APIFY_TOKEN") is None
```

- [ ] **Step 4: Run smoke test**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 4 passed.

If pytest reports `ModuleNotFoundError: pytest`, install with `pip3 install pytest` and re-run.

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py tests/conftest.py tests/test_apify_hashtag_test.py
git commit -m "scaffold: hashtag test script + pytest harness"
```

---

## Task 4: `load_config` and `estimate_cost`

**Files:**
- Modify: `apify_hashtag_test.py`
- Modify: `tests/test_apify_hashtag_test.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_apify_hashtag_test.py`:

```python
import json
import pytest


def test_load_config_reads_valid_file(tmp_path):
    cfg_path = tmp_path / "h.json"
    cfg_path.write_text(json.dumps({
        "run_label": "test",
        "results_per_hashtag": 30,
        "top_n_posts_for_comments": 5,
        "comments_per_top_post": 10,
        "max_estimated_cost_usd": 2.0,
        "hashtags": [{"tag": "x", "segment": "y"}],
    }))
    cfg = M.load_config(str(cfg_path))
    assert cfg["run_label"] == "test"
    assert len(cfg["hashtags"]) == 1


def test_load_config_rejects_missing_field(tmp_path):
    cfg_path = tmp_path / "h.json"
    cfg_path.write_text(json.dumps({"run_label": "test"}))  # missing fields
    with pytest.raises(ValueError, match="missing required field"):
        M.load_config(str(cfg_path))


def test_estimate_cost_simple():
    cfg = {
        "results_per_hashtag": 10,
        "top_n_posts_for_comments": 2,
        "comments_per_top_post": 5,
        "hashtags": [{"tag": "a", "segment": "x"}, {"tag": "b", "segment": "x"}],
    }
    # 2 hashtags × 10 posts × 0.001 = 0.020
    # 2 hashtags × 2 posts × 5 comments × 0.0002 = 0.004
    # total = 0.024
    assert M.estimate_cost(cfg) == pytest.approx(0.024)


def test_estimate_cost_full_28_hashtags():
    cfg = {
        "results_per_hashtag": 30,
        "top_n_posts_for_comments": 5,
        "comments_per_top_post": 10,
        "hashtags": [{"tag": str(i), "segment": "x"} for i in range(28)],
    }
    # 28 × 30 × 0.001 = 0.84
    # 28 × 5 × 10 × 0.0002 = 0.28
    # total = 1.12
    assert M.estimate_cost(cfg) == pytest.approx(1.12)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 4 failures (`AttributeError: module ... has no attribute 'load_config'` and similar).

- [ ] **Step 3: Implement `load_config` and `estimate_cost`**

Append to `apify_hashtag_test.py` (after the constants block):

```python
REQUIRED_CONFIG_FIELDS = (
    "run_label",
    "results_per_hashtag",
    "top_n_posts_for_comments",
    "comments_per_top_post",
    "max_estimated_cost_usd",
    "hashtags",
)


def load_config(path):
    """Read and validate hashtags.json. Raises ValueError on missing fields."""
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    for field in REQUIRED_CONFIG_FIELDS:
        if field not in cfg:
            raise ValueError(f"config missing required field: {field}")
    if not isinstance(cfg["hashtags"], list) or not cfg["hashtags"]:
        raise ValueError("config.hashtags must be a non-empty list")
    for i, h in enumerate(cfg["hashtags"]):
        if "tag" not in h or "segment" not in h:
            raise ValueError(f"config.hashtags[{i}] missing 'tag' or 'segment'")
    return cfg


def estimate_cost(cfg):
    """Return estimated USD cost for one full run of cfg."""
    n_tags = len(cfg["hashtags"])
    posts = n_tags * cfg["results_per_hashtag"]
    comments = (
        n_tags
        * cfg["top_n_posts_for_comments"]
        * cfg["comments_per_top_post"]
    )
    return posts * COST_PER_POST + comments * COST_PER_COMMENT
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 5 passed (1 from Task 3 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py tests/test_apify_hashtag_test.py
git commit -m "feat: load_config and estimate_cost with validation + tests"
```

---

## Task 5: `flatten_posts` pure function

**Files:**
- Modify: `apify_hashtag_test.py`
- Modify: `tests/test_apify_hashtag_test.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_apify_hashtag_test.py`:

```python
def test_flatten_posts_attributes_hashtag_and_segment():
    scrape_results = [
        {
            "tag": "手遊",
            "segment": "gamer_tech",
            "posts": [
                {
                    "id": "p1", "shortCode": "abc", "url": "https://ig/p/abc",
                    "ownerUsername": "userA", "ownerFullName": "User A",
                    "caption": "love this", "likesCount": 100,
                    "commentsCount": 10, "timestamp": "2026-04-28T10:00:00Z",
                },
                {
                    "id": "p2", "shortCode": "def", "url": "https://ig/p/def",
                    "ownerUsername": "userB", "ownerFullName": "User B",
                    "caption": "another", "likesCount": 50,
                    "commentsCount": 5, "timestamp": "2026-04-28T11:00:00Z",
                },
            ],
            "top_post_ids": {"p1"},
            "comments_by_post": {},
            "errors": [],
        }
    ]
    rows = M.flatten_posts(scrape_results)
    assert len(rows) == 2
    p1 = next(r for r in rows if r["post_id"] == "p1")
    assert p1["hashtag"] == "手遊"
    assert p1["segment"] == "gamer_tech"
    assert p1["owner_username"] == "userA"
    assert p1["caption"] == "love this"
    assert p1["likes_count"] == 100
    assert p1["is_top_engaged"] is True
    p2 = next(r for r in rows if r["post_id"] == "p2")
    assert p2["is_top_engaged"] is False


def test_flatten_posts_handles_missing_fields():
    scrape_results = [
        {
            "tag": "x", "segment": "y",
            "posts": [{"id": "p1"}],  # all other fields missing
            "top_post_ids": set(), "comments_by_post": {}, "errors": [],
        }
    ]
    rows = M.flatten_posts(scrape_results)
    assert len(rows) == 1
    r = rows[0]
    assert r["post_id"] == "p1"
    assert r["caption"] == ""
    assert r["likes_count"] == 0
    assert r["owner_username"] == ""
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_apify_hashtag_test.py::test_flatten_posts_attributes_hashtag_and_segment tests/test_apify_hashtag_test.py::test_flatten_posts_handles_missing_fields -v`
Expected: 2 failures (`AttributeError: module ... has no attribute 'flatten_posts'`).

- [ ] **Step 3: Implement `flatten_posts`**

Append to `apify_hashtag_test.py`:

```python
def flatten_posts(scrape_results):
    """Walk all hashtag results, emit posts.csv rows. Pure function."""
    rows = []
    for hr in scrape_results:
        top_ids = hr.get("top_post_ids", set())
        for p in hr.get("posts", []):
            rows.append({
                "hashtag": hr["tag"],
                "segment": hr["segment"],
                "post_id": p.get("id", ""),
                "shortcode": p.get("shortCode", ""),
                "url": p.get("url", ""),
                "owner_username": p.get("ownerUsername", ""),
                "owner_full_name": p.get("ownerFullName", ""),
                "caption": p.get("caption", "") or "",
                "likes_count": p.get("likesCount", 0) or 0,
                "comments_count": p.get("commentsCount", 0) or 0,
                "timestamp": p.get("timestamp", ""),
                "is_top_engaged": p.get("id") in top_ids,
            })
    return rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py tests/test_apify_hashtag_test.py
git commit -m "feat: flatten_posts with hashtag/segment attribution"
```

---

## Task 6: `flatten_comments` pure function

**Files:**
- Modify: `apify_hashtag_test.py`
- Modify: `tests/test_apify_hashtag_test.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_apify_hashtag_test.py`:

```python
def test_flatten_comments_attributes_post_and_hashtag():
    scrape_results = [
        {
            "tag": "手遊",
            "segment": "gamer_tech",
            "posts": [
                {"id": "p1", "url": "https://ig/p/abc", "ownerUsername": "userA"},
            ],
            "top_post_ids": {"p1"},
            "comments_by_post": {
                "p1": [
                    {
                        "id": "c1", "ownerUsername": "fanA",
                        "text": "好正", "likesCount": 3,
                        "timestamp": "2026-04-28T12:00:00Z",
                    },
                    {
                        "id": "c2", "ownerUsername": "fanB",
                        "text": "really?", "likesCount": 0,
                        "timestamp": "2026-04-28T12:30:00Z",
                    },
                ]
            },
            "errors": [],
        }
    ]
    rows = M.flatten_comments(scrape_results)
    assert len(rows) == 2
    c1 = next(r for r in rows if r["comment_id"] == "c1")
    assert c1["hashtag"] == "手遊"
    assert c1["segment"] == "gamer_tech"
    assert c1["post_id"] == "p1"
    assert c1["post_url"] == "https://ig/p/abc"
    assert c1["post_owner_username"] == "userA"
    assert c1["comment_owner_username"] == "fanA"
    assert c1["text"] == "好正"
    assert c1["likes_count"] == 3


def test_flatten_comments_skips_posts_without_comments():
    scrape_results = [
        {
            "tag": "x", "segment": "y",
            "posts": [{"id": "p1", "url": "u", "ownerUsername": "o"}],
            "top_post_ids": {"p1"},
            "comments_by_post": {},  # nothing drilled
            "errors": [],
        }
    ]
    assert M.flatten_comments(scrape_results) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_apify_hashtag_test.py::test_flatten_comments_attributes_post_and_hashtag tests/test_apify_hashtag_test.py::test_flatten_comments_skips_posts_without_comments -v`
Expected: 2 failures.

- [ ] **Step 3: Implement `flatten_comments`**

Append to `apify_hashtag_test.py`:

```python
def flatten_comments(scrape_results):
    """Walk comments_by_post for every hashtag, emit comments.csv rows."""
    rows = []
    for hr in scrape_results:
        post_lookup = {p.get("id"): p for p in hr.get("posts", [])}
        for post_id, comments in hr.get("comments_by_post", {}).items():
            post = post_lookup.get(post_id, {})
            for c in comments:
                rows.append({
                    "hashtag": hr["tag"],
                    "segment": hr["segment"],
                    "post_id": post_id,
                    "post_url": post.get("url", ""),
                    "post_owner_username": post.get("ownerUsername", ""),
                    "comment_id": c.get("id", ""),
                    "comment_owner_username": c.get("ownerUsername", ""),
                    "text": c.get("text", "") or "",
                    "likes_count": c.get("likesCount", 0) or 0,
                    "timestamp": c.get("timestamp", ""),
                })
    return rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py tests/test_apify_hashtag_test.py
git commit -m "feat: flatten_comments with post/hashtag attribution"
```

---

## Task 7: `aggregate_kols` pure function

**Files:**
- Modify: `apify_hashtag_test.py`
- Modify: `tests/test_apify_hashtag_test.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_apify_hashtag_test.py`:

```python
def test_aggregate_kols_ranks_by_total_engagement():
    posts_rows = [
        # userA: 2 posts, 100+50 likes, 10+5 comments → 165 total
        {"hashtag": "手遊", "segment": "gamer_tech", "owner_username": "userA",
         "url": "u/p1", "likes_count": 100, "comments_count": 10},
        {"hashtag": "電競", "segment": "gamer_tech", "owner_username": "userA",
         "url": "u/p2", "likes_count": 50, "comments_count": 5},
        # userB: 1 post, 30 likes, 2 comments → 32 total
        {"hashtag": "手遊", "segment": "gamer_tech", "owner_username": "userB",
         "url": "u/p3", "likes_count": 30, "comments_count": 2},
    ]
    kols = M.aggregate_kols(posts_rows)
    assert len(kols) == 2
    assert kols[0]["username"] == "userA"
    assert kols[0]["appearances"] == 2
    assert kols[0]["total_likes"] == 150
    assert kols[0]["total_comments"] == 15
    assert set(kols[0]["hashtags"].split(";")) == {"手遊", "電競"}
    assert kols[0]["segments"] == "gamer_tech"
    assert kols[0]["top_post_url"] == "u/p1"  # highest engagement post
    assert kols[1]["username"] == "userB"
    assert kols[1]["appearances"] == 1


def test_aggregate_kols_ignores_blank_username():
    posts_rows = [
        {"hashtag": "x", "segment": "y", "owner_username": "",
         "url": "u", "likes_count": 1, "comments_count": 0},
    ]
    assert M.aggregate_kols(posts_rows) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_apify_hashtag_test.py::test_aggregate_kols_ranks_by_total_engagement tests/test_apify_hashtag_test.py::test_aggregate_kols_ignores_blank_username -v`
Expected: 2 failures.

- [ ] **Step 3: Implement `aggregate_kols`**

Append to `apify_hashtag_test.py`:

```python
def aggregate_kols(posts_rows):
    """Group posts by owner_username, return KOL rows ranked by engagement."""
    by_user = {}
    for r in posts_rows:
        u = r.get("owner_username") or ""
        if not u:
            continue
        entry = by_user.setdefault(u, {
            "username": u,
            "appearances": 0,
            "hashtags": set(),
            "segments": set(),
            "total_likes": 0,
            "total_comments": 0,
            "top_post_url": "",
            "_top_engagement": -1,
        })
        entry["appearances"] += 1
        entry["hashtags"].add(r["hashtag"])
        entry["segments"].add(r["segment"])
        entry["total_likes"] += r["likes_count"]
        entry["total_comments"] += r["comments_count"]
        engagement = r["likes_count"] + r["comments_count"]
        if engagement > entry["_top_engagement"]:
            entry["_top_engagement"] = engagement
            entry["top_post_url"] = r["url"]

    rows = []
    for entry in by_user.values():
        rows.append({
            "username": entry["username"],
            "appearances": entry["appearances"],
            "hashtags": ";".join(sorted(entry["hashtags"])),
            "segments": ";".join(sorted(entry["segments"])),
            "total_likes": entry["total_likes"],
            "total_comments": entry["total_comments"],
            "top_post_url": entry["top_post_url"],
        })
    rows.sort(key=lambda r: r["total_likes"] + r["total_comments"], reverse=True)
    return rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py tests/test_apify_hashtag_test.py
git commit -m "feat: aggregate_kols ranked by total engagement"
```

---

## Task 8: `write_csv` helper with utf-8-sig BOM

**Files:**
- Modify: `apify_hashtag_test.py`
- Modify: `tests/test_apify_hashtag_test.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_apify_hashtag_test.py`:

```python
def test_write_csv_emits_bom_and_chinese_roundtrips(tmp_path):
    path = tmp_path / "out.csv"
    rows = [
        {"col_a": "手遊", "col_b": 42},
        {"col_a": "港大", "col_b": 7},
    ]
    M.write_csv(str(path), rows, ["col_a", "col_b"])

    raw = path.read_bytes()
    # utf-8-sig BOM is EF BB BF at start
    assert raw[:3] == b"\xef\xbb\xbf"

    # Round-trip
    text = raw.decode("utf-8-sig")
    assert "手遊" in text
    assert "港大" in text
    assert text.splitlines()[0] == "col_a,col_b"


def test_write_csv_handles_empty_rows(tmp_path):
    path = tmp_path / "empty.csv"
    M.write_csv(str(path), [], ["a", "b"])
    text = path.read_text(encoding="utf-8-sig")
    assert text.strip() == "a,b"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_apify_hashtag_test.py::test_write_csv_emits_bom_and_chinese_roundtrips tests/test_apify_hashtag_test.py::test_write_csv_handles_empty_rows -v`
Expected: 2 failures.

- [ ] **Step 3: Implement `write_csv`**

Append to `apify_hashtag_test.py`:

```python
def write_csv(path, rows, columns):
    """Write rows to path as utf-8-sig CSV (BOM so Excel reads Chinese)."""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in columns})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py tests/test_apify_hashtag_test.py
git commit -m "feat: write_csv helper with utf-8-sig BOM for Excel/Chinese"
```

---

## Task 9: `write_manifest` helper

**Files:**
- Modify: `apify_hashtag_test.py`
- Modify: `tests/test_apify_hashtag_test.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_apify_hashtag_test.py`:

```python
def test_write_manifest_serialises_run_metadata(tmp_path):
    path = tmp_path / "manifest.json"
    run_meta = {
        "run_id": "2026-04-28T22-45-00_test",
        "started_at": "2026-04-28T22:45:00Z",
        "completed_at": "2026-04-28T22:49:00Z",
        "duration_seconds": 240,
        "config": {"run_label": "test", "hashtags": []},
        "estimated_cost_usd": 1.18,
    }
    scrape_results = [
        {
            "tag": "手遊", "segment": "gamer_tech",
            "posts": [{"id": "p1"}, {"id": "p2"}],
            "comments_by_post": {"p1": [{"id": "c1"}, {"id": "c2"}]},
            "top_post_ids": {"p1"},
            "errors": [],
        }
    ]
    posts_rows = [
        {"owner_username": "userA"},
        {"owner_username": "userA"},
    ]
    M.write_manifest(str(path), run_meta, scrape_results, posts_rows)

    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["run_id"] == "2026-04-28T22-45-00_test"
    assert data["estimated_cost_usd"] == 1.18
    assert len(data["per_hashtag"]) == 1
    h = data["per_hashtag"][0]
    assert h["tag"] == "手遊"
    assert h["posts_returned"] == 2
    assert h["comments_returned"] == 2
    assert h["comments_drilled_on_posts"] == 1
    assert h["error"] is None
    assert data["totals"]["posts"] == 2
    assert data["totals"]["comments"] == 2
    assert data["totals"]["unique_creators"] == 1


def test_write_manifest_records_hashtag_errors(tmp_path):
    path = tmp_path / "manifest.json"
    scrape_results = [
        {"tag": "x", "segment": "y", "posts": [],
         "comments_by_post": {}, "top_post_ids": set(),
         "errors": ["HTTP 429: rate limited"]},
    ]
    M.write_manifest(str(path), {"run_id": "r", "config": {}}, scrape_results, [])
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["per_hashtag"][0]["error"] == "HTTP 429: rate limited"
    assert data["errors"] == ["x: HTTP 429: rate limited"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_apify_hashtag_test.py::test_write_manifest_serialises_run_metadata tests/test_apify_hashtag_test.py::test_write_manifest_records_hashtag_errors -v`
Expected: 2 failures.

- [ ] **Step 3: Implement `write_manifest`**

Append to `apify_hashtag_test.py`:

```python
def write_manifest(path, run_meta, scrape_results, posts_rows):
    """Write manifest.json combining run_meta with per-hashtag stats."""
    per_hashtag = []
    errors = []
    total_posts = 0
    total_comments = 0
    for hr in scrape_results:
        n_posts = len(hr.get("posts", []))
        cmts = hr.get("comments_by_post", {})
        n_comments = sum(len(v) for v in cmts.values())
        n_drilled = len(cmts)
        first_error = hr.get("errors")[0] if hr.get("errors") else None
        per_hashtag.append({
            "tag": hr["tag"],
            "segment": hr["segment"],
            "posts_returned": n_posts,
            "comments_drilled_on_posts": n_drilled,
            "comments_returned": n_comments,
            "error": first_error,
        })
        if first_error:
            errors.append(f"{hr['tag']}: {first_error}")
        total_posts += n_posts
        total_comments += n_comments

    unique_creators = len({r.get("owner_username") for r in posts_rows
                           if r.get("owner_username")})

    manifest = {
        **run_meta,
        "per_hashtag": per_hashtag,
        "totals": {
            "posts": total_posts,
            "comments": total_comments,
            "unique_creators": unique_creators,
        },
        "errors": errors,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py tests/test_apify_hashtag_test.py
git commit -m "feat: write_manifest aggregates per-hashtag stats and errors"
```

---

## Task 10: `call_actor` network helper

**Files:**
- Modify: `apify_hashtag_test.py`

This wraps the same pattern as `apify_brand_probe.py` but writes raw output to a caller-specified directory. Network code; no unit tests — manual smoke in Task 14.

- [ ] **Step 1: Implement `call_actor`**

Append to `apify_hashtag_test.py`:

```python
def call_actor(actor_id, input_data, label, raw_dir, token):
    """Run an Apify actor synchronously, save raw JSON, return items.

    Returns (items, error). On success, items is a list and error is None.
    On failure, items is None and error is a short string.
    """
    url = (
        f"{API_BASE}/acts/{actor_id.replace('/', '~')}"
        f"/run-sync-get-dataset-items?token={token}"
    )
    req = Request(
        url,
        data=json.dumps(input_data).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    try:
        with urlopen(req, timeout=300) as r:
            items = json.loads(r.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"

    elapsed = time.time() - t0
    safe = label.replace("/", "_").replace(" ", "_")
    raw_path = Path(raw_dir) / f"{safe}.json"
    raw_path.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  ✓ {label}: {len(items)} items in {elapsed:.1f}s")
    return items, None
```

- [ ] **Step 2: Verify the file still parses**

Run: `python3 -c "import apify_hashtag_test"`
Expected: no output, no error.

- [ ] **Step 3: Commit**

```bash
git add apify_hashtag_test.py
git commit -m "feat: call_actor with raw JSON capture and error tuple"
```

---

## Task 11: `scrape_hashtag` orchestrator

**Files:**
- Modify: `apify_hashtag_test.py`

Wraps two `call_actor` invocations per hashtag plus the engagement sort. Network-dependent; no unit tests.

- [ ] **Step 1: Implement `scrape_hashtag`**

Append to `apify_hashtag_test.py`:

```python
def scrape_hashtag(tag, segment, cfg, raw_dir, token):
    """Pull posts + drilled comments for one hashtag.

    Returns dict matching the shape consumed by flatten_*.
    """
    print(f"\n→ #{tag} ({segment})")
    result = {
        "tag": tag,
        "segment": segment,
        "posts": [],
        "comments_by_post": {},
        "top_post_ids": set(),
        "errors": [],
    }

    posts, err = call_actor(
        HASHTAG_ACTOR,
        {"hashtags": [tag], "resultsLimit": cfg["results_per_hashtag"]},
        f"hashtag_{tag}",
        raw_dir,
        token,
    )
    if err:
        result["errors"].append(err)
        return result
    result["posts"] = posts or []

    if not result["posts"]:
        return result

    # Pick top N by (likes + comments) desc
    def engagement(p):
        return (p.get("likesCount") or 0) + (p.get("commentsCount") or 0)

    top_posts = sorted(result["posts"], key=engagement, reverse=True)[
        : cfg["top_n_posts_for_comments"]
    ]
    result["top_post_ids"] = {p.get("id") for p in top_posts if p.get("id")}

    for p in top_posts:
        post_url = p.get("url")
        post_id = p.get("id")
        if not post_url or not post_id:
            continue
        comments, c_err = call_actor(
            COMMENT_ACTOR,
            {"directUrls": [post_url],
             "resultsLimit": cfg["comments_per_top_post"]},
            f"comments_{p.get('shortCode', post_id)}",
            raw_dir,
            token,
        )
        if c_err:
            result["errors"].append(f"comments({post_id}): {c_err}")
            continue
        result["comments_by_post"][post_id] = comments or []

    return result
```

- [ ] **Step 2: Verify the file still parses**

Run: `python3 -c "import apify_hashtag_test"`
Expected: no output, no error.

- [ ] **Step 3: Commit**

```bash
git add apify_hashtag_test.py
git commit -m "feat: scrape_hashtag pulls posts then drills top-N for comments"
```

---

## Task 12: `main()` — argparse, output dir, run plan, --from-raw mode

**Files:**
- Modify: `apify_hashtag_test.py`

- [ ] **Step 1: Implement `main` and friends**

Append to `apify_hashtag_test.py`:

```python
def confirm_cost(estimated, cap, force):
    """Prompt the user (unless --force) before scraping."""
    if estimated > cap and not force:
        print(f"\n✗ Estimated cost ${estimated:.2f} exceeds cap ${cap:.2f}.")
        print("  Re-run with --force to override, or lower the cap in config.")
        sys.exit(1)
    if force:
        return
    answer = input(f"\nProceed with scrape (~${estimated:.2f})? [y/N]: ").strip().lower()
    if answer != "y":
        print("Aborted.")
        sys.exit(0)


def make_output_dir(run_label):
    """Create apify_output/<timestamp>_<run_label>/ + raw/ subdir, return path."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    run_id = f"{timestamp}_{run_label}"
    out = Path("apify_output") / run_id
    (out / "raw").mkdir(parents=True, exist_ok=True)
    return out, run_id


def reflatten_from_raw(run_dir):
    """Re-flatten an existing run's raw/ JSON into CSVs + manifest in place."""
    run_dir = Path(run_dir)
    raw_dir = run_dir / "raw"
    if not raw_dir.is_dir():
        sys.exit(f"✗ {raw_dir} does not exist or is not a directory")

    # Try to recover original config from existing manifest if present
    existing_manifest = run_dir / "manifest.json"
    if not existing_manifest.is_file():
        sys.exit(f"✗ {existing_manifest} not found — cannot reconstruct hashtag list")
    cfg = json.loads(existing_manifest.read_text(encoding="utf-8"))["config"]

    scrape_results = []
    for h in cfg["hashtags"]:
        tag = h["tag"]
        posts_path = raw_dir / f"hashtag_{tag}.json"
        posts = json.loads(posts_path.read_text(encoding="utf-8")) if posts_path.is_file() else []
        # Re-derive top post ids by engagement
        def eng(p):
            return (p.get("likesCount") or 0) + (p.get("commentsCount") or 0)
        top_posts = sorted(posts, key=eng, reverse=True)[: cfg["top_n_posts_for_comments"]]
        top_ids = {p.get("id") for p in top_posts if p.get("id")}

        comments_by_post = {}
        for p in top_posts:
            shortcode = p.get("shortCode", p.get("id"))
            cpath = raw_dir / f"comments_{shortcode}.json"
            if cpath.is_file():
                comments_by_post[p.get("id")] = json.loads(cpath.read_text(encoding="utf-8"))

        scrape_results.append({
            "tag": tag, "segment": h["segment"],
            "posts": posts, "comments_by_post": comments_by_post,
            "top_post_ids": top_ids, "errors": [],
        })

    posts_rows = flatten_posts(scrape_results)
    comments_rows = flatten_comments(scrape_results)
    kol_rows = aggregate_kols(posts_rows)

    write_csv(run_dir / "posts.csv", posts_rows, POSTS_COLUMNS)
    write_csv(run_dir / "comments.csv", comments_rows, COMMENTS_COLUMNS)
    write_csv(run_dir / "kol_candidates.csv", kol_rows, KOLS_COLUMNS)

    run_meta = {
        "run_id": run_dir.name,
        "config": cfg,
        "estimated_cost_usd": 0.0,
        "note": "re-flattened from raw/, no actor calls made",
    }
    write_manifest(run_dir / "manifest.json", run_meta, scrape_results, posts_rows)

    print(f"\n✓ Re-flattened {len(scrape_results)} hashtags into {run_dir}")
    print(f"  posts: {len(posts_rows)}  comments: {len(comments_rows)}  kols: {len(kol_rows)}")


def main():
    parser = argparse.ArgumentParser(description="Apify IG hashtag-driven test")
    parser.add_argument("--config", default="hashtags.json")
    parser.add_argument("--force", action="store_true",
                        help="skip cost confirmation prompt")
    parser.add_argument("--from-raw", default=None,
                        help="re-flatten an existing run dir without scraping")
    args = parser.parse_args()

    if args.from_raw:
        reflatten_from_raw(args.from_raw)
        return

    load_dotenv_if_present()
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        sys.exit("APIFY_TOKEN not set. Add it to .env or export it. "
                 "Get one at: https://console.apify.com/settings/integrations")

    cfg = load_config(args.config)
    estimated = estimate_cost(cfg)

    n_tags = len(cfg["hashtags"])
    expected_posts = n_tags * cfg["results_per_hashtag"]
    expected_comments = (n_tags * cfg["top_n_posts_for_comments"]
                         * cfg["comments_per_top_post"])
    print("Run plan:")
    print(f"  {n_tags} hashtags × {cfg['results_per_hashtag']} posts            = ~{expected_posts} posts")
    print(f"  {n_tags} hashtags × {cfg['top_n_posts_for_comments']} posts × {cfg['comments_per_top_post']} cmts   = ~{expected_comments} comments")
    print(f"  Estimated Apify cost              = ~${estimated:.2f} USD")
    print(f"  Cost cap (from config)            = ${cfg['max_estimated_cost_usd']:.2f} USD")

    confirm_cost(estimated, cfg["max_estimated_cost_usd"], args.force)

    out_dir, run_id = make_output_dir(cfg["run_label"])
    raw_dir = out_dir / "raw"
    started_at = datetime.now(timezone.utc)

    scrape_results = []
    for h in cfg["hashtags"]:
        scrape_results.append(
            scrape_hashtag(h["tag"], h["segment"], cfg, raw_dir, token)
        )

    posts_rows = flatten_posts(scrape_results)
    comments_rows = flatten_comments(scrape_results)
    kol_rows = aggregate_kols(posts_rows)

    write_csv(out_dir / "posts.csv", posts_rows, POSTS_COLUMNS)
    write_csv(out_dir / "comments.csv", comments_rows, COMMENTS_COLUMNS)
    write_csv(out_dir / "kol_candidates.csv", kol_rows, KOLS_COLUMNS)

    completed_at = datetime.now(timezone.utc)
    run_meta = {
        "run_id": run_id,
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "duration_seconds": int((completed_at - started_at).total_seconds()),
        "config": cfg,
        "estimated_cost_usd": estimated,
    }
    write_manifest(out_dir / "manifest.json", run_meta, scrape_results, posts_rows)

    n_failed = sum(1 for hr in scrape_results if hr["errors"])
    print("\n" + "=" * 60)
    print(f"DONE in {run_meta['duration_seconds']}s. Output: {out_dir}")
    print(f"  Posts: {len(posts_rows)}  Comments: {len(comments_rows)}  KOLs: {len(kol_rows)}")
    print(f"  Hashtags with errors: {n_failed}/{n_tags}")
    print(f"  Check actual cost at: https://console.apify.com/billing")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the file still parses**

Run: `python3 -c "import apify_hashtag_test"`
Expected: no output, no error.

- [ ] **Step 3: Verify --help works**

Run: `python3 apify_hashtag_test.py --help`
Expected: argparse usage block listing `--config`, `--force`, `--from-raw`.

- [ ] **Step 4: Run unit tests one more time**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 15 passed (no regressions from main being added).

- [ ] **Step 5: Commit**

```bash
git add apify_hashtag_test.py
git commit -m "feat: main() with cost prompt, output dir, --from-raw re-flatten"
```

---

## Task 13: Synthetic --from-raw integration test

**Files:**
- Create: `tests/fixtures/sample_run/raw/hashtag_手遊.json`
- Create: `tests/fixtures/sample_run/raw/comments_abc123.json`
- Create: `tests/fixtures/sample_run/manifest.json`
- Modify: `tests/test_apify_hashtag_test.py`

This task verifies the end-to-end flatten path works with realistic JSON shapes by running `--from-raw` against synthetic fixtures.

- [ ] **Step 1: Create the fixture directory and files**

Create `tests/fixtures/sample_run/raw/hashtag_手遊.json` with:

```json
[
  {
    "id": "post1", "shortCode": "abc123", "url": "https://instagram.com/p/abc123",
    "ownerUsername": "gamer_hk", "ownerFullName": "Gamer HK",
    "caption": "新5G plan 真係快好多 #手遊 #香港5g",
    "likesCount": 250, "commentsCount": 18,
    "timestamp": "2026-04-25T10:00:00Z"
  },
  {
    "id": "post2", "shortCode": "def456", "url": "https://instagram.com/p/def456",
    "ownerUsername": "casual_player", "ownerFullName": "",
    "caption": "Genshin lag again",
    "likesCount": 12, "commentsCount": 1,
    "timestamp": "2026-04-26T14:00:00Z"
  }
]
```

Create `tests/fixtures/sample_run/raw/comments_abc123.json` with:

```json
[
  {
    "id": "c1", "ownerUsername": "fan1",
    "text": "邊間電訊商呀？", "likesCount": 3,
    "timestamp": "2026-04-25T11:00:00Z"
  },
  {
    "id": "c2", "ownerUsername": "fan2",
    "text": "I switched to 3HK last month", "likesCount": 1,
    "timestamp": "2026-04-25T12:00:00Z"
  }
]
```

Create `tests/fixtures/sample_run/manifest.json` with:

```json
{
  "run_id": "fixture_run",
  "config": {
    "run_label": "fixture",
    "results_per_hashtag": 30,
    "top_n_posts_for_comments": 1,
    "comments_per_top_post": 10,
    "max_estimated_cost_usd": 1.0,
    "hashtags": [
      { "tag": "手遊", "segment": "gamer_tech" }
    ]
  }
}
```

- [ ] **Step 2: Write the integration test**

Append to `tests/test_apify_hashtag_test.py`:

```python
import shutil


def test_reflatten_from_raw_produces_expected_csvs(tmp_path):
    src = Path(__file__).parent / "fixtures" / "sample_run"
    dst = tmp_path / "run"
    shutil.copytree(src, dst)

    M.reflatten_from_raw(str(dst))

    posts_csv = (dst / "posts.csv").read_text(encoding="utf-8-sig")
    assert "gamer_hk" in posts_csv
    assert "casual_player" in posts_csv
    assert "手遊" in posts_csv
    assert "gamer_tech" in posts_csv
    # post1 should be marked top-engaged (highest likes+comments)
    lines = posts_csv.splitlines()
    post1_line = next(l for l in lines if "post1" in l)
    assert ",True" in post1_line or "True\r" in post1_line or post1_line.endswith("True")

    comments_csv = (dst / "comments.csv").read_text(encoding="utf-8-sig")
    assert "邊間電訊商呀？" in comments_csv
    assert "fan1" in comments_csv
    assert "fan2" in comments_csv

    kols_csv = (dst / "kol_candidates.csv").read_text(encoding="utf-8-sig")
    # gamer_hk has higher engagement (250+18 = 268) than casual_player (12+1=13)
    kols_lines = kols_csv.splitlines()
    assert kols_lines[1].startswith("gamer_hk,")  # row[0] = header
    assert kols_lines[2].startswith("casual_player,")

    manifest = json.loads((dst / "manifest.json").read_text())
    assert manifest["totals"]["posts"] == 2
    assert manifest["totals"]["comments"] == 2
    assert manifest["totals"]["unique_creators"] == 2
```

(The `Path` import was added in earlier tests; if not, add `from pathlib import Path` at top of test file.)

- [ ] **Step 3: Run the integration test**

Run: `pytest tests/test_apify_hashtag_test.py::test_reflatten_from_raw_produces_expected_csvs -v`
Expected: PASS.

If `Path` is undefined, add `from pathlib import Path` at the top of `tests/test_apify_hashtag_test.py` and re-run.

- [ ] **Step 4: Run full test suite**

Run: `pytest tests/test_apify_hashtag_test.py -v`
Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures tests/test_apify_hashtag_test.py
git commit -m "test: end-to-end --from-raw integration with synthetic fixtures"
```

---

## Task 14: Manual smoke test against Apify (live, costs ~$0.05)

**Files:** none modified. This validates the live network path with one cheap hashtag.

- [ ] **Step 1: Create a one-hashtag temp config**

Create `hashtags_smoke.json` (do NOT commit):

```json
{
  "run_label": "smoke",
  "results_per_hashtag": 5,
  "top_n_posts_for_comments": 1,
  "comments_per_top_post": 5,
  "max_estimated_cost_usd": 0.10,
  "hashtags": [
    { "tag": "速度測試", "segment": "gamer_tech" }
  ]
}
```

- [ ] **Step 2: Run with the smoke config**

Run: `export APIFY_TOKEN=<your_token> && python3 apify_hashtag_test.py --config hashtags_smoke.json --force`

Expected:
- Run plan printed with `~5 posts`, `~5 comments`, `~$0.01`.
- Two `→ #速度測試` actor calls succeed (or one fails gracefully).
- `apify_output/<timestamp>_smoke/` contains `manifest.json`, `posts.csv`, `comments.csv`, `kol_candidates.csv`, and `raw/hashtag_速度測試.json`.

- [ ] **Step 3: Inspect outputs**

Run: `ls apify_output/*_smoke/ && head -3 apify_output/*_smoke/posts.csv`
Expected: directory listing shows the 4 expected files plus `raw/`. The CSV header line is `hashtag,segment,post_id,...`.

- [ ] **Step 4: Try `--from-raw` against the smoke run**

Run: `python3 apify_hashtag_test.py --from-raw apify_output/<timestamp>_smoke`
Expected: `✓ Re-flattened 1 hashtags ...` printed; CSVs are overwritten in place.

- [ ] **Step 5: Clean up the temp config**

Run: `rm hashtags_smoke.json`

- [ ] **Step 6: No commit needed**

This was a validation step. The output directory is gitignored, no source code changed.

---

## Task 15: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a "Hashtag-Driven Test" section to `README.md`**

Add this section after the "Data Format" section, before "Deployment":

```markdown
## Hashtag-Driven Test (Apify)

Probes 28 Instagram hashtags across 3 audience segments for HK telco signal. Outputs flat CSVs for qualitative review.

```bash
export APIFY_TOKEN=apify_api_xxxx
python3 apify_hashtag_test.py
```

**Outputs** to `apify_output/<timestamp>_<run_label>/`:
- `posts.csv` — one row per post (28 hashtags × 30 posts ≈ 840 rows)
- `comments.csv` — top 10 comments on the 5 most-engaged posts per hashtag
- `kol_candidates.csv` — creators ranked by aggregate engagement
- `manifest.json` — run metadata, per-hashtag stats, errors
- `raw/` — raw Apify JSON per actor call

**Re-flatten an existing run** without re-scraping:

```bash
python3 apify_hashtag_test.py --from-raw apify_output/<run_dir>
```

**Config:** edit `hashtags.json` to change the hashtag list, sample sizes, or cost cap.

**Spec:** [`docs/superpowers/specs/2026-04-28-hashtag-driven-test-design.md`](docs/superpowers/specs/2026-04-28-hashtag-driven-test-design.md)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README section for apify_hashtag_test.py"
```

---

## Summary

After completing all 15 tasks:

| Artifact | Status |
|---|---|
| `apify_brand_probe.py` | renamed from `apify_test.py`, runnable |
| `apify_hashtag_test.py` | new, ~400 lines, 15 unit + 1 integration test |
| `hashtags.json` | new, 28 hashtags across 3 segments |
| `tests/test_apify_hashtag_test.py` | 16 passing tests |
| `tests/fixtures/sample_run/` | synthetic data for `--from-raw` test |
| `.gitignore` | ignores `apify_output/` and `apify_test_output/` |
| `README.md` | documents the new test |

Live smoke test (Task 14) confirms one real Apify run end-to-end at ~$0.01. Full 28-hashtag run is left for the user to trigger when ready (estimated ~$1.18 USD).

Out of scope, deferred to follow-up:
- Scoring / verdict logic
- Dashboard tab in `dashboard.js`
- KOL profile enrichment (followers, bios)
- Scheduling / weekly cron
