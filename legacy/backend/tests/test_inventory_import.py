"""Inventory import behavior through the public HTTP contract."""
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=tmp_path / "import.db")
    with TestClient(app) as test_client:
        yield test_client


def xlsx_bytes(rows: list[list[str]]) -> bytes:
    """Build a tiny valid workbook without tying the fixture to an XLSX library."""
    def col_name(index: int) -> str:
        result = ""
        while index:
            index, remainder = divmod(index - 1, 26)
            result = chr(65 + remainder) + result
        return result

    sheet_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = "".join(
            f'<c r="{col_name(col_index)}{row_index}" t="inlineStr"><is><t>{value}</t></is></c>'
            for col_index, value in enumerate(row, start=1)
        )
        sheet_rows.append(f'<row r="{row_index}">{cells}</row>')
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    with BytesIO() as output:
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", content_types)
            archive.writestr(
                "_rels/.rels",
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                '</Relationships>',
            )
            archive.writestr(
                "xl/workbook.xml",
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>',
            )
            archive.writestr(
                "xl/_rels/workbook.xml.rels",
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                '</Relationships>',
            )
            archive.writestr(
                "xl/worksheets/sheet1.xml",
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                + "".join(sheet_rows)
                + '</sheetData></worksheet>',
            )
        return output.getvalue()


def test_csv_preview_suggests_polish_columns_without_writing(client):
    response = client.post(
        "/api/import/preview?filename=magazyn.csv",
        content="Nazwa asortymentu;Stan [szt];Ilość minimalna;Lokalizacja\nKartony;54;12;Strefa A-1\n".encode(),
    )
    assert response.status_code == 200
    preview = response.json()
    assert preview["row_count"] == 1
    assert preview["mapping"]["name"]["column"] == 0
    assert preview["mapping"]["quantity"]["column"] == 1
    assert preview["mapping"]["minimum"]["column"] == 2
    assert preview["mapping"]["location"]["column"] == 3
    assert next(i for i in client.get("/api/stock").json()["items"] if i["name"] == "Kartony")["quantity"] == 54


def test_repository_demo_workbook_uses_polish_inventory_headers(client):
    workbook = Path(__file__).parents[2] / "demo-magazyn.xlsx"
    response = client.post(
        "/api/import/preview?filename=demo-magazyn.xlsx",
        content=workbook.read_bytes(),
    )
    assert response.status_code == 200
    preview = response.json()
    assert preview["row_count"] == 4
    assert {field: value["column"] for field, value in preview["mapping"].items()} == {
        "name": 0,
        "quantity": 1,
        "minimum": 2,
        "location": 3,
        "unit": 4,
    }


def test_xlsx_mapping_confirmation_imports_and_reimport_updates_without_duplicates(client):
    body = xlsx_bytes(
        [
            ["Nazwa asortymentu", "Stan [szt]", "Minimum", "Lokalizacja"],
            ["Kartony", "52", "12", "Strefa A-1"],
            ["Nowy towar", "7", "3", "Strefa C-2"],
        ]
    )
    preview = client.post("/api/import/preview?filename=magazyn.xlsx", content=body)
    assert preview.status_code == 200
    mapping = {field: value["column"] for field, value in preview.json()["mapping"].items()}
    confirmation = {"import_id": preview.json()["import_id"], "mapping": mapping}
    result = client.post("/api/import/confirm", json=confirmation)
    assert result.status_code == 200
    assert result.json()["inserted"] == 1
    assert result.json()["updated"] == 1
    assert result.json()["total"] == 2

    stock = client.get("/api/stock").json()["items"]
    assert len(stock) == 4
    kartony = next(item for item in stock if item["name"] == "Kartony")
    assert (kartony["quantity"], kartony["minimum"], kartony["location"]) == (52, 12, "Strefa A-1")

    repeat = client.post("/api/import/preview?filename=magazyn.xlsx", content=body).json()
    result = client.post(
        "/api/import/confirm",
        json={"import_id": repeat["import_id"], "mapping": mapping},
    )
    assert result.json()["inserted"] == 0
    assert result.json()["updated"] == 2
    assert len(client.get("/api/stock").json()["items"]) == 4


def test_import_keeps_reorder_queue_in_sync_with_stock_and_minimum(client):
    def import_kartony(quantity: int, minimum: int):
        preview = client.post(
            "/api/import/preview?filename=magazyn.csv",
            content=f"Nazwa,Stan,Minimum,Jednostka\nKartony,{quantity},{minimum},szt\n".encode(),
        ).json()
        mapping = {field: value["column"] for field, value in preview["mapping"].items()}
        return client.post(
            "/api/import/confirm",
            json={"import_id": preview["import_id"], "mapping": mapping},
        )

    assert import_kartony(quantity=10, minimum=12).status_code == 200
    drafts = client.get("/api/reorder-drafts").json()["drafts"]
    assert len(drafts) == 1
    assert drafts[0]["quantity"] == 50

    assert import_kartony(quantity=10, minimum=70).status_code == 200
    drafts = client.get("/api/reorder-drafts").json()["drafts"]
    assert len(drafts) == 1
    assert drafts[0]["quantity"] == 60

    assert import_kartony(quantity=20, minimum=12).status_code == 200
    assert client.get("/api/reorder-drafts").json()["drafts"] == []
    assert import_kartony(quantity=20, minimum=0).status_code == 200
    history = client.get("/api/history").json()["entries"]
    event_types = {entry["event_type"] for entry in history}
    assert {"reorder_draft_created", "reorder_draft_updated", "reorder_cancelled"} <= event_types
    import_events = [entry for entry in history if entry["event_type"] == "inventory_import"]
    assert len(import_events) == 4
    assert any("minimum: 12→70" in entry["details"] for entry in import_events)
    assert any("minimum: 12→0" in entry["details"] for entry in import_events)


def test_import_is_not_written_until_user_confirms(client):
    preview = client.post(
        "/api/import/preview?filename=items.csv",
        content="Nazwa,Ilość\nPozycja testowa,5\n".encode(),
    ).json()
    assert all(item["name"] != "Pozycja testowa" for item in client.get("/api/stock").json()["items"])
    mapping = {field: value["column"] for field, value in preview["mapping"].items()}
    response = client.post(
        "/api/import/confirm",
        json={"import_id": preview["import_id"], "mapping": mapping},
    )
    assert response.status_code == 200
    assert any(item["name"] == "Pozycja testowa" for item in client.get("/api/stock").json()["items"])


def test_missing_optional_columns_preserve_existing_minimum_unit_and_location(client):
    preview = client.post(
        "/api/import/preview?filename=items.csv",
        content="Nazwa,Ilość\nFolia stretch,14\n".encode(),
    ).json()
    mapping = {field: value["column"] for field, value in preview["mapping"].items()}
    result = client.post(
        "/api/import/confirm",
        json={"import_id": preview["import_id"], "mapping": mapping},
    )
    assert result.status_code == 200
    item = next(item for item in client.get("/api/stock").json()["items"] if item["name"] == "Folia stretch")
    assert (item["quantity"], item["minimum"], item["unit"], item["location"]) == (14, 6, "rolka", "Strefa C-1")


def test_missing_required_mapping_reports_warning_and_cannot_confirm(client):
    preview = client.post(
        "/api/import/preview?filename=items.csv",
        content="Opis,Uwagi\nKartony,do sprawdzenia\n".encode(),
    ).json()
    assert "name" in preview["missing_required"]
    assert "quantity" in preview["missing_required"]
    assert any("lokalizacji" in warning for warning in preview["warnings"])
    response = client.post(
        "/api/import/confirm",
        json={"import_id": preview["import_id"], "mapping": {"name": None, "quantity": None}},
    )
    assert response.status_code == 422


def test_invalid_row_does_not_partially_import(client):
    preview = client.post(
        "/api/import/preview?filename=items.csv",
        content="Nazwa,Ilość\nDobre,5\nZłe,nie-liczba\n".encode(),
    ).json()
    mapping = {field: value["column"] for field, value in preview["mapping"].items()}
    response = client.post(
        "/api/import/confirm",
        json={"import_id": preview["import_id"], "mapping": mapping},
    )
    assert response.status_code == 422
    assert all(item["name"] != "Dobre" for item in client.get("/api/stock").json()["items"])
