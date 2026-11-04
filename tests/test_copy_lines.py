"""Copy in generated sentences: an injury reads naturally after "with", and his reply to your opening
never capitalizes a phrase in the middle of a sentence."""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from coach_career import scenes
from engine import game_config
from sim import news


def test_injury_after_with() -> None:
    assert news._with("back spasms") == "back spasms"
    assert news._with("ankle sprain") == "an ankle sprain"
    assert news._with("concussion") == "a concussion"
    assert news._with("high ankle sprain") == "a high ankle sprain"
    for t in game_config.INJURY_TYPES:
        s = f"loses starting QB for 3 weeks with {news._with(t)}."
        assert " a back" not in s and " a ankle" not in s, s


def test_topic_case_in_his_reply() -> None:
    for phrase in scenes.PHRASES.values():
        for line in scenes.PRESENT_LINES["hit"]:
            text = line.format(topic=phrase, Topic=phrase[0].upper() + phrase[1:])
            assert text[0].isupper(), text
            cap = phrase[0].upper() + phrase[1:]
            if not text.startswith(cap):
                assert cap not in text, f"a phrase capitalized mid-sentence: {text}"


if __name__ == "__main__":
    test_injury_after_with()
    test_topic_case_in_his_reply()
    print("copy lines ok")
