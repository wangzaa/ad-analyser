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


def write_csv(path, rows, columns):
    """Write rows to path as utf-8-sig CSV (BOM so Excel reads Chinese)."""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in columns})


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

    existing_manifest = run_dir / "manifest.json"
    if not existing_manifest.is_file():
        sys.exit(f"✗ {existing_manifest} not found — cannot reconstruct hashtag list")
    cfg = json.loads(existing_manifest.read_text(encoding="utf-8"))["config"]

    scrape_results = []
    for h in cfg["hashtags"]:
        tag = h["tag"]
        posts_path = raw_dir / f"hashtag_{tag}.json"
        posts = json.loads(posts_path.read_text(encoding="utf-8")) if posts_path.is_file() else []

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
