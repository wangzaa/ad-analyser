"""Invariants the generator must satisfy. Run: python3 -m pytest etl/test_generate_3hk_mock.py -v"""
import random
from etl import generate_3hk_mock as gen


def test_segment_count_targets_sum_to_3000():
    assert sum(s["count"] for s in gen.SEGMENT_TARGETS.values()) == 3000


def test_all_plan_types_have_known_segment():
    valid_segments = set(gen.SEGMENT_TARGETS.keys())
    for code, segment, *_ in gen.PLAN_TYPES:
        assert segment in valid_segments, f"Plan {code} → unknown segment {segment}"


def test_rng_determinism():
    """Two fresh RNG instances with same seed produce same output."""
    a = random.Random(20260430)
    b = random.Random(20260430)
    assert [a.random() for _ in range(10)] == [b.random() for _ in range(10)]
