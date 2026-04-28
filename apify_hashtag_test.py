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
