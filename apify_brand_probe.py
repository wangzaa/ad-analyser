#!/usr/bin/env python3
"""
Apify IG brand-handle probe — small validation of HK telco brand profiles.

Archived from the original apify_test.py. Kept runnable for re-validation.
For hashtag-driven scraping, see apify_hashtag_test.py.

Usage:
    export APIFY_TOKEN=apify_api_xxxx
    python apify_brand_probe.py
"""

import json
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

TOKEN = os.environ.get("APIFY_TOKEN")
if not TOKEN:
    sys.exit("Set APIFY_TOKEN env var. Get one at: https://console.apify.com/settings/integrations")

OUT = Path("./apify_test_output")
OUT.mkdir(exist_ok=True)

BRANDS = ["smartonehk", "3hongkong", "csl_mobile"]   # adjust if handles are wrong
HASHTAG = "5GHK"

API = "https://api.apify.com/v2"


def call_actor(actor_id, input_data, label):
    """Run an Apify actor synchronously, return the dataset items."""
    print(f"\n→ {label} (actor: {actor_id})")
    print(f"  Input: {json.dumps(input_data, ensure_ascii=False)[:120]}")

    # Run the actor and wait for completion (sync endpoint)
    url = f"{API}/acts/{actor_id.replace('/', '~')}/run-sync-get-dataset-items?token={TOKEN}"
    req = Request(url, data=json.dumps(input_data).encode(), method="POST",
                  headers={"Content-Type": "application/json"})

    t0 = time.time()
    try:
        with urlopen(req, timeout=300) as r:
            items = json.loads(r.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:400]
        print(f"  ✗ HTTP {e.code}: {body}")
        return None
    except Exception as e:
        print(f"  ✗ {type(e).__name__}: {e}")
        return None

    elapsed = time.time() - t0
    print(f"  ✓ {len(items)} items in {elapsed:.1f}s")

    # Save raw
    safe = label.lower().replace(" ", "_").replace("#", "")
    (OUT / f"{safe}.json").write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return items


def report_profile(items):
    if not items:
        return
    print(f"\n  Profiles returned: {len(items)}")
    for p in items:
        name = p.get("username", "?")
        followers = p.get("followersCount", "?")
        bio = (p.get("biography", "") or "")[:80]
        verified = "✓" if p.get("verified") else " "
        print(f"    {verified} @{name:<20} {followers:>10} followers  bio: {bio}")


def report_hashtag(items, hashtag):
    if not items:
        return
    print(f"\n  Posts under #{hashtag}: {len(items)}")
    for p in items[:5]:
        caption = (p.get("caption", "") or "")[:60].replace("\n", " ")
        likes = p.get("likesCount", "?")
        owner = p.get("ownerUsername", "?")
        print(f"    @{owner:<20} {likes:>6} ❤  {caption}")


def report_comments(items):
    if not items:
        return
    print(f"\n  Comments: {len(items)}")
    # Detect language mix
    sample_text = " ".join((c.get("text") or "")[:50] for c in items[:10])
    has_chinese = any("\u4e00" <= c <= "\u9fff" for c in sample_text)
    has_english = any(c.isalpha() and ord(c) < 128 for c in sample_text)
    print(f"  Languages observed: {'Chinese ' if has_chinese else ''}{'English' if has_english else ''}")
    for c in items[:5]:
        owner = c.get("ownerUsername", "?")
        text = (c.get("text") or "")[:70].replace("\n", " ")
        likes = c.get("likesCount", 0)
        print(f"    @{owner:<20} {likes:>3}❤  {text}")


# ─── 1. Profiles ───────────────────────────────────────────────
profiles = call_actor(
    "apify/instagram-profile-scraper",
    {"usernames": BRANDS},
    "1_brand_profiles",
)
report_profile(profiles)

# Pick first profile that has recent posts to drill into
post_url = None
if profiles:
    for p in profiles:
        latest = p.get("latestPosts", [])
        if latest:
            post_url = latest[0].get("url")
            print(f"\n  Drill-down candidate: {post_url}")
            break

# ─── 2. Hashtag sample ─────────────────────────────────────────
hashtag = call_actor(
    "apify/instagram-hashtag-scraper",
    {"hashtags": [HASHTAG], "resultsLimit": 10},
    f"2_hashtag_{HASHTAG}",
)
report_hashtag(hashtag, HASHTAG)

# ─── 3. Comments on a brand post ───────────────────────────────
if post_url:
    comments = call_actor(
        "apify/instagram-comment-scraper",
        {"directUrls": [post_url], "resultsLimit": 30},
        "3_post_comments",
    )
    report_comments(comments)
else:
    print("\n  ⚠ No post URL available, skipping comment test")

# ─── Summary ───────────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST COMPLETE")
print("=" * 60)
print(f"Raw outputs saved to: {OUT.resolve()}")
print("\nValidation checklist:")
print("  [ ] Profiles match expected HK telco brands")
print("  [ ] Hashtag posts include HK-relevant content")
print("  [ ] Comments include Cantonese / mixed language")
print("  [ ] Schema fields are useful (followers, captions, dates)")
print("  [ ] Total cost < USD 0.05 (check console.apify.com/billing)")
print("\nNext: open the JSON files in apify_test_output/ and inspect.")
