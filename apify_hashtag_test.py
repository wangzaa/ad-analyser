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
