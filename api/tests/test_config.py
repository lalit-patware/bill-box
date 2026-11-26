import pytest

from app.config import ai_available, get_settings


@pytest.mark.parametrize(
    ("key", "enabled", "expected"),
    [("sk-x", "true", True), ("", "true", False), ("sk-x", "false", False)],
)
def test_ai_available(
    monkeypatch: pytest.MonkeyPatch, key: str, enabled: str, expected: bool
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", key)
    monkeypatch.setenv("AI_ENABLED", enabled)
    get_settings.cache_clear()
    assert ai_available() is expected
