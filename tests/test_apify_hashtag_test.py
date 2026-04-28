"""Unit tests for apify_hashtag_test pure functions."""
import os
import shutil
from pathlib import Path
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
            "posts": [{"id": "p1"}],
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
            "comments_by_post": {},
            "errors": [],
        }
    ]
    assert M.flatten_comments(scrape_results) == []


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
    assert kols[0]["top_post_url"] == "u/p1"
    assert kols[1]["username"] == "userB"
    assert kols[1]["appearances"] == 1


def test_aggregate_kols_ignores_blank_username():
    posts_rows = [
        {"hashtag": "x", "segment": "y", "owner_username": "",
         "url": "u", "likes_count": 1, "comments_count": 0},
    ]
    assert M.aggregate_kols(posts_rows) == []


def test_write_csv_emits_bom_and_chinese_roundtrips(tmp_path):
    path = tmp_path / "out.csv"
    rows = [
        {"col_a": "手遊", "col_b": 42},
        {"col_a": "港大", "col_b": 7},
    ]
    M.write_csv(str(path), rows, ["col_a", "col_b"])

    raw = path.read_bytes()
    assert raw[:3] == b"\xef\xbb\xbf"

    text = raw.decode("utf-8-sig")
    assert "手遊" in text
    assert "港大" in text
    assert text.splitlines()[0] == "col_a,col_b"


def test_write_csv_handles_empty_rows(tmp_path):
    path = tmp_path / "empty.csv"
    M.write_csv(str(path), [], ["a", "b"])
    text = path.read_text(encoding="utf-8-sig")
    assert text.strip() == "a,b"


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
    lines = posts_csv.splitlines()
    post1_line = next(l for l in lines if "post1" in l)
    assert post1_line.endswith("True") or post1_line.endswith("True\r")

    comments_csv = (dst / "comments.csv").read_text(encoding="utf-8-sig")
    assert "邊間電訊商呀？" in comments_csv
    assert "fan1" in comments_csv
    assert "fan2" in comments_csv

    kols_csv = (dst / "kol_candidates.csv").read_text(encoding="utf-8-sig")
    kols_lines = kols_csv.splitlines()
    assert kols_lines[1].startswith("gamer_hk,")
    assert kols_lines[2].startswith("casual_player,")

    manifest = json.loads((dst / "manifest.json").read_text())
    assert manifest["totals"]["posts"] == 2
    assert manifest["totals"]["comments"] == 2
    assert manifest["totals"]["unique_creators"] == 2
