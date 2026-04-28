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
