# Hashtag-Driven Test — Design Spec

**Date:** 2026-04-28
**Source:** `Hashtag_Driven_Test.md` (segment hypotheses), this doc (workflow design)
**Status:** Approved for implementation planning

## Purpose

Probe Instagram for HK telco signal across 28 Cantonese/English hashtags spanning three audience segments (Gamer/Tech, Student/Youth, Direct telco/value-seeker). The test extracts raw posts and comments to disk for qualitative review. Scoring and verdicts (KEEP/MAYBE/DROP) are deferred to a manual review pass once the data is in hand.

This is the foundation for a future weekly production scrape, so the workflow is structured (config-driven, separated stages) rather than throwaway. A dashboard surface for the data is planned but deferred until after the first review pass.

## Scope

**In scope**
- Pull 30 posts per hashtag via `apify/instagram-hashtag-scraper`
- Drill into the 5 most-engaged posts per hashtag for top 10 comments via `apify/instagram-comment-scraper`
- Flatten results into `posts.csv`, `comments.csv`, `kol_candidates.csv`
- Write a run manifest with per-hashtag stats, errors, and cost
- Preserve raw JSON per actor call for re-processing without re-scraping

**Out of scope (deferred)**
- Scoring / verdict logic (KEEP/MAYBE/DROP)
- Dashboard tab in `dashboard.js`
- KOL profile enrichment (follower counts, bios)
- Scheduling / weekly cron
- Sentiment analysis automation

## Hashtag set (28 total)

Three segments. The full list lives in `hashtags.json` (config); reproduced here for the spec record.

**Segment 4 — Gamer / Tech / Power user (10)**
`手遊`, `香港手遊`, `電競`, `5g`, `5gnetwork`, `香港5g`, `gameplayhk`, `手機評測`, `速度測試`, `網速`

**Segment 5 — Student / Youth (8)**
`港大`, `中大`, `科大`, `dse`, `hkuni`, `exchangestudent`, `freshyear`, `迎新`

**Segment 6 — Direct telco / value-seeker (10)**
`上台優惠`, `轉台`, `手機計劃`, `寬頻`, `5g家居寬頻`, `家居寬頻`, `hkbroadband`, `sim卡`, `月費`, `平價計劃`

## Architecture

```
hashtags.json (config)
        │
        ▼
apify_hashtag_test.py
        │
        ├── For each hashtag:
        │     1. Pull posts (instagram-hashtag-scraper, N=30)
        │     2. Sort posts by (likes + comments) desc
        │     3. Pick top 5 → pull comments (instagram-comment-scraper, M=10 each)
        │     4. Save raw JSON to raw/ subdir
        │
        ├── Flatten:
        │     • posts.csv          (one row per post)
        │     • comments.csv       (one row per comment, drilled posts only)
        │     • kol_candidates.csv (creators ranked by aggregate engagement)
        │
        └── Write manifest.json (run metadata, per-hashtag stats, cost, errors)

Output: apify_output/<timestamp>_<run_label>/
```

Three concerns are separated:
1. **Scraping + raw I/O** — orchestrator + `call_actor()` helper
2. **Flattening** — pure functions from raw dicts → CSV rows (no I/O)
3. **Writing** — CSV + JSON serialisation

Pure flatteners mean re-running with `--from-raw <run_dir>` reprocesses existing raw JSON without re-hitting Apify, useful when tweaking schemas.

## Config file (`hashtags.json`)

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

`segment` flows through to all CSVs. `run_label` becomes part of the output directory name. `max_estimated_cost_usd` enforces a cost ceiling.

## Output schemas

### Directory layout per run

```
apify_output/
  2026-04-28T22-45-00_segments_4_5_6_test/
    manifest.json
    posts.csv
    comments.csv
    kol_candidates.csv
    raw/
      hashtag_手遊.json
      hashtag_香港手遊.json
      ...
      comments_<post_shortcode>.json
      ...
```

### `posts.csv`

One row per post, across all hashtags.

| Column | Source |
|---|---|
| `hashtag` | Which hashtag query returned this post |
| `segment` | Segment label from config |
| `post_id` | Apify `id` |
| `shortcode` | For URL building |
| `url` | Post URL |
| `owner_username` | Creator handle |
| `owner_full_name` | Creator display name |
| `caption` | Full caption (no truncation) |
| `likes_count` | Engagement |
| `comments_count` | Engagement |
| `timestamp` | Post date |
| `is_top_engaged` | Bool — was this drilled for comments? |

### `comments.csv`

One row per comment, only for drilled posts.

| Column | Source |
|---|---|
| `hashtag` | Parent post's hashtag |
| `segment` | Parent post's segment |
| `post_id` | Parent post |
| `post_url` | Parent post |
| `post_owner_username` | Who posted |
| `comment_id` | Apify `id` |
| `comment_owner_username` | Who commented |
| `text` | Full comment text |
| `likes_count` | Comment engagement |
| `timestamp` | Comment date |

### `kol_candidates.csv`

One row per unique creator across the sample, ranked.

| Column | Computation |
|---|---|
| `username` | Distinct |
| `appearances` | Count of posts in our sample |
| `hashtags` | Semicolon-joined list of hashtags they appeared under |
| `segments` | Semicolon-joined list of segments |
| `total_likes` | Sum across their posts |
| `total_comments` | Sum across their posts |
| `top_post_url` | Their highest-engagement post in our sample |

Sorted by `total_likes + total_comments` desc.

### `manifest.json`

```json
{
  "run_id": "2026-04-28T22-45-00_segments_4_5_6_test",
  "started_at": "2026-04-28T22:45:00Z",
  "completed_at": "2026-04-28T22:49:14Z",
  "duration_seconds": 254,
  "config": { /* echo of hashtags.json */ },
  "per_hashtag": [
    {
      "tag": "手遊",
      "segment": "gamer_tech",
      "posts_returned": 30,
      "comments_drilled_on_posts": 5,
      "comments_returned": 47,
      "error": null
    }
  ],
  "totals": {
    "posts": 297,
    "comments": 423,
    "unique_creators": 184
  },
  "estimated_cost_usd": 1.18,
  "errors": []
}
```

CSVs are written with utf-8-sig BOM so Chinese opens correctly in Excel.

## Pipeline functions

```
load_config(path) → dict
    Reads hashtags.json, validates required fields, returns config.

estimate_cost(config) → float
    expected_posts    = len(hashtags) × results_per_hashtag
    expected_comments = len(hashtags) × top_n_posts_for_comments × comments_per_top_post
    cost = expected_posts × COST_PER_POST + expected_comments × COST_PER_COMMENT
    Constants live at top of script:
      COST_PER_POST    = 0.001  (Apify hashtag scraper, USD)
      COST_PER_COMMENT = 0.0002 (Apify comment scraper, USD)
    These are estimates only; actual cost is read from console.apify.com/billing
    after the run. Aborts with prompt if estimate > max_estimated_cost_usd
    (unless --force).

call_actor(actor_id, input_data, label) → list[dict] | None
    Uses run-sync-get-dataset-items, 300s timeout (same pattern as
    existing apify_brand_probe.py). Saves raw JSON to raw/<label>.json.
    Returns None on HTTPError; caller decides continuation.

scrape_hashtag(tag, segment, config) → dict
    1. call_actor(instagram-hashtag-scraper) → posts
    2. Sort posts by (likes + comments) desc
    3. Pick top N (config.top_n_posts_for_comments)
    4. For each top post: call_actor(instagram-comment-scraper) → comments
    Returns {"tag", "segment", "posts": [...],
             "comments_by_post": {post_id: [...]},
             "top_post_ids": [...], "errors": [...]}

flatten_posts(scrape_results) → list[dict]
    Walks all hashtag results, emits posts.csv rows. Sets is_top_engaged
    by checking membership in top_post_ids. Pure function.

flatten_comments(scrape_results) → list[dict]
    Walks comments_by_post for every hashtag, emits comments.csv rows
    with full attribution. Pure function.

aggregate_kols(posts_rows) → list[dict]
    Groups posts by owner_username, computes appearances/totals/lists,
    sorts desc, returns kol_candidates.csv rows. Pure function.

write_csv(path, rows, columns) → None
    csv.DictWriter with utf-8-sig BOM.

write_manifest(path, run_meta, scrape_results) → None

main():
    1. Parse args (--config, --force, --from-raw)
    2. Load + validate config
    3. Estimate + confirm cost (unless --force)
    4. Create output dir
    5. For each hashtag: scrape_hashtag() (one failure → log + continue)
    6. Flatten → write 3 CSVs
    7. Write manifest
    8. Print summary table to stdout
```

## Error handling

- One failed hashtag does not abort the run
- HTTP errors / timeouts / empty results are caught, logged, and recorded in `manifest.per_hashtag[i].error` and `manifest.errors`
- Raw JSON is always written before flattening; flatten bugs do not cost a re-scrape
- `--from-raw <run_dir>` re-flattens an existing run's `raw/` directory without hitting Apify

## Cost guardrail

On startup, before any actor call:

```
Run plan:
  28 hashtags × 30 posts            = ~840 posts
  28 hashtags × 5 posts × 10 cmts   = ~1400 comments
  Estimated Apify cost              = ~$1.18 USD
  Cost cap (from config)            = $2.00 USD
Proceed? [y/N]
```

`--force` skips the prompt. If estimate > cap, the script refuses unless `--force`.

## CLI

```
python apify_hashtag_test.py                          # default: hashtags.json, prompt to confirm cost
python apify_hashtag_test.py --config other.json      # custom config
python apify_hashtag_test.py --force                  # skip cost prompt
python apify_hashtag_test.py --from-raw apify_output/2026-04-28T22-45-00_segments_4_5_6_test
                                                       # re-flatten existing raw JSON;
                                                       # no actor calls, no cost prompt;
                                                       # overwrites CSVs + manifest in-place
```

`APIFY_TOKEN` env var is required (matches existing brand probe).

## File changes on disk

| Action | Path |
|---|---|
| `git mv` | `apify_test.py` → `apify_brand_probe.py` |
| Create | `apify_hashtag_test.py` |
| Create | `hashtags.json` |
| Create | `apify_output/` directory (gitignored) |
| Update | `.gitignore` — add `apify_output/` and `apify_test_output/` |

`apify_test_output/` is left in place for now; can be pruned later.

## Cost estimate

At Apify's published rates for the relevant actors, expected cost for one full run:

- ~840 posts × ~$0.001/post ≈ $0.84
- ~1,400 comments × ~$0.0002/comment ≈ $0.28
- Total: ~$1.10–1.20

Cap: $2.00 (configurable in `hashtags.json`).

## Success criteria

The run is considered successful when:

1. `posts.csv`, `comments.csv`, `kol_candidates.csv`, and `manifest.json` all exist in the output directory
2. At least 70% of hashtags returned non-empty post arrays (some failure is expected on the noisier tags)
3. Total post count ≥ 500 (rough sanity check on whether the actors actually delivered)
4. Total comment count ≥ 800
5. Run cost is at or below the estimate

A successful run does not mean the data is "good" — that judgement happens during the manual qualitative review pass that comes after.
