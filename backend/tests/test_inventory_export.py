"""Inventory export stays compatible with the public import contract."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=tmp_path / "export.db")
    with TestClient(app) as test_client:
        yield test_client


def inventory_values(items):
    return sorted(
        (item["name"], item["quantity"], item["minimum"], item["location"], item["unit"])
        for item in items
    )


@pytest.mark.parametrize(
    ("file_format", "content_type"),
    [
        ("csv", "text/csv"),
        ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ],
)
def test_export_round_trips_through_inventory_import_without_data_loss_or_duplicates(
    client, file_format, content_type
):
    before = client.get("/api/stock").json()["items"]

    exported = client.get(f"/api/export/{file_format}")

    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith(content_type)
    assert f'magazyn.{file_format}' in exported.headers["content-disposition"]

    preview_response = client.post(
        f"/api/import/preview?filename=magazyn.{file_format}",
        content=exported.content,
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert [header["label"] for header in preview["headers"]] == [
        "Nazwa asortymentu",
        "Ilość",
        "Stan minimalny",
        "Lokalizacja",
        "Jednostka",
    ]
    mapping = {field: value["column"] for field, value in preview["mapping"].items()}
    assert mapping == {"name": 0, "quantity": 1, "minimum": 2, "location": 3, "unit": 4}

    imported = client.post(
        "/api/import/confirm",
        json={"import_id": preview["import_id"], "mapping": mapping},
    )

    assert imported.status_code == 200
    assert imported.json() == {"inserted": 0, "updated": len(before), "total": len(before)}
    after = client.get("/api/stock").json()["items"]
    assert len(after) == len(before)
    assert inventory_values(after) == inventory_values(before)
