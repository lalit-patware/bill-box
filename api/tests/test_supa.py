from app.supa import service_headers


def test_new_secret_key_only_in_apikey_header() -> None:
    assert service_headers("sb_secret_abc") == {"apikey": "sb_secret_abc"}


def test_legacy_service_role_jwt_also_bearer() -> None:
    assert service_headers("eyJhbGciOi.x.y") == {
        "apikey": "eyJhbGciOi.x.y",
        "Authorization": "Bearer eyJhbGciOi.x.y",
    }
