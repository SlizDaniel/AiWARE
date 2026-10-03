"""Small, dependency-free CSV/XLSX adapter for the inventory import flow."""
import csv
import io
import posixpath
import re
import unicodedata
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 10_000
REQUIRED_FIELDS = ("name", "quantity")
FIELDS = ("name", "quantity", "minimum", "location", "unit")
ALIASES = {
    "name": ("nazwa", "nazwa asortymentu", "nazwa produktu", "towar", "produkt", "item name"),
    "quantity": ("ilosc", "stan", "stan szt", "stan ilosc", "quantity", "stock", "qty"),
    "minimum": ("minimum", "min", "stan minimalny", "ilosc minimalna", "prog minimalny", "reorder point"),
    "location": ("lokalizacja", "miejsce", "strefa", "location", "shelf"),
    "unit": ("jednostka", "unit", "miara"),
}
NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_PACKAGE_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
NS_MAIN_URI = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

EXPORT_COLUMNS = (
    ("Nazwa asortymentu", "name"),
    ("Ilość", "quantity"),
    ("Stan minimalny", "minimum"),
    ("Lokalizacja", "location"),
    ("Jednostka", "unit"),
)


class ImportFileError(ValueError):
    """The uploaded file isn't a supported, readable inventory sheet."""


def _normalise(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    plain = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9]+", plain))


def _csv_rows(data: bytes) -> list[list[str]]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("cp1250")
        except UnicodeDecodeError as exc:
            raise ImportFileError("Nie udało się odczytać kodowania pliku CSV.") from exc
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return [list(row) for row in csv.reader(io.StringIO(text), dialect) if any(cell.strip() for cell in row)]


def _column_index(reference: str) -> int:
    letters = re.match(r"([A-Z]+)", reference.upper())
    if not letters:
        return 0
    value = 0
    for char in letters.group(1):
        value = value * 26 + ord(char) - ord("A") + 1
    return value - 1


def _xlsx_rows(data: bytes) -> list[list[str]]:
    try:
        with ZipFile(io.BytesIO(data)) as workbook:
            shared: list[str] = []
            if "xl/sharedStrings.xml" in workbook.namelist():
                root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
                shared = [
                    "".join(node.text or "" for node in item.iter(f"{NS_MAIN}t"))
                    for item in root.findall(f"{NS_MAIN}si")
                ]

            sheet_path = "xl/worksheets/sheet1.xml"
            if "xl/workbook.xml" in workbook.namelist():
                book = ET.fromstring(workbook.read("xl/workbook.xml"))
                first_sheet = book.find(f"{NS_MAIN}sheets/{NS_MAIN}sheet")
                if first_sheet is not None:
                    relation_id = first_sheet.attrib.get(f"{NS_REL}id")
                    rels_path = "xl/_rels/workbook.xml.rels"
                    if relation_id and rels_path in workbook.namelist():
                        rels = ET.fromstring(workbook.read(rels_path))
                        relation = next(
                            (item for item in rels.findall(f"{NS_PACKAGE_REL}Relationship") if item.attrib.get("Id") == relation_id),
                            None,
                        )
                        if relation:
                            target = relation.attrib.get("Target", "")
                            sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))

            if sheet_path not in workbook.namelist():
                raise ImportFileError("Arkusz kalkulacyjny nie zawiera czytelnej pierwszej karty.")
            root = ET.fromstring(workbook.read(sheet_path))
            rows: list[list[str]] = []
            for row in root.findall(f".//{NS_MAIN}sheetData/{NS_MAIN}row"):
                values: dict[int, str] = {}
                for cell in row.findall(f"{NS_MAIN}c"):
                    index = _column_index(cell.attrib.get("r", "A1"))
                    cell_type = cell.attrib.get("t")
                    if cell_type == "inlineStr":
                        value = "".join(node.text or "" for node in cell.iter(f"{NS_MAIN}t"))
                    else:
                        raw = cell.findtext(f"{NS_MAIN}v", default="")
                        if cell_type == "s" and raw:
                            try:
                                value = shared[int(raw)]
                            except (IndexError, ValueError):
                                value = ""
                        else:
                            value = raw
                    values[index] = value
                if values:
                    rows.append([values.get(index, "") for index in range(max(values) + 1)])
            return rows
    except (BadZipFile, KeyError, ET.ParseError) as exc:
        raise ImportFileError("Plik XLSX jest uszkodzony lub ma nieobsługiwany format.") from exc


def read_inventory_file(filename: str, data: bytes) -> tuple[list[str], list[list[str]]]:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImportFileError("Plik jest za duży (limit 5 MB).")
    suffix = filename.rsplit(".", 1)[-1].casefold() if "." in filename else ""
    if suffix == "csv":
        rows = _csv_rows(data)
    elif suffix == "xlsx":
        rows = _xlsx_rows(data)
    else:
        raise ImportFileError("Obsługiwane formaty plików to XLSX i CSV.")
    if len(rows) < 2:
        raise ImportFileError("Plik musi zawierać nagłówki i przynajmniej jeden wiersz danych.")
    headers = [cell.strip() for cell in rows[0]]
    if not any(headers):
        raise ImportFileError("Nie znaleziono nagłówków kolumn.")
    data_rows = [row + [""] * (len(headers) - len(row)) for row in rows[1:]]
    data_rows = [row[: len(headers)] for row in data_rows]
    if len(data_rows) > MAX_IMPORT_ROWS:
        raise ImportFileError(f"Plik może zawierać maksymalnie {MAX_IMPORT_ROWS} wierszy danych.")
    return headers, data_rows


def suggest_mapping(headers: list[str]) -> dict[str, dict[str, float | int | None]]:
    """Suggest distinct columns from common Polish/English inventory headings."""
    normalized = [_normalise(header) for header in headers]
    aliases = {field: {_normalise(alias) for alias in ALIASES[field]} for field in FIELDS}
    result: dict[str, dict[str, float | int | None]] = {
        field: {"column": None, "confidence": 0.0} for field in FIELDS
    }
    used: set[int] = set()
    # Reserve exact matches first so "stan minimalny" cannot be consumed by the
    # shorter fuzzy alias "stan" for quantity.
    for field in FIELDS:
        for index, header in enumerate(normalized):
            if header and index not in used and header in aliases[field]:
                result[field] = {"column": index, "confidence": 0.96}
                used.add(index)
                break
    for field in FIELDS:
        if result[field]["column"] is not None:
            continue
        candidates = [
            index
            for index, header in enumerate(normalized)
            if header
            and index not in used
            and any(alias in header or header in alias for alias in aliases[field] if len(alias) >= 4)
        ]
        if candidates:
            result[field] = {"column": candidates[0], "confidence": 0.78}
            used.add(candidates[0])
    return result


def validate_and_map_rows(
    headers: list[str], rows: list[list[str]], mapping: dict[str, int | None]
) -> list[dict[str, str | int | None]]:
    for field, index in mapping.items():
        if index is not None and (type(index) is not int or index < 0 or index >= len(headers)):
            raise ImportFileError(f"Nieprawidłowa kolumna dla pola „{field}”.")
    for field in REQUIRED_FIELDS:
        index = mapping.get(field)
        if index is None:
            raise ImportFileError("Wybierz kolumnę nazwy oraz ilości przed zatwierdzeniem importu.")
    selected_columns = [index for index in mapping.values() if index is not None]
    if len(selected_columns) != len(set(selected_columns)):
        raise ImportFileError("Każde pole musi być przypisane do innej kolumny.")

    items: list[dict[str, str | int | None]] = []
    seen: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        def value_for(field: str, default: str = "") -> str:
            index = mapping.get(field)
            return row[index].strip() if isinstance(index, int) and 0 <= index < len(row) else default

        name = value_for("name")
        quantity_text = value_for("quantity")
        if not name:
            raise ImportFileError(f"Wiersz {row_number}: brak nazwy pozycji.")
        try:
            quantity = int(quantity_text.replace(" ", "").replace(",", "."))
        except ValueError as exc:
            raise ImportFileError(f"Wiersz {row_number}: ilość „{quantity_text}” nie jest liczbą całkowitą.") from exc
        minimum_text = value_for("minimum")
        try:
            minimum = int(minimum_text.replace(" ", "").replace(",", ".")) if minimum_text else None
        except ValueError as exc:
            raise ImportFileError(f"Wiersz {row_number}: minimum „{minimum_text}” nie jest liczbą całkowitą.") from exc
        if quantity < 0 or (minimum is not None and minimum < 0):
            raise ImportFileError(f"Wiersz {row_number}: ilość i minimum nie mogą być ujemne.")
        key = name.casefold()
        if key in seen:
            raise ImportFileError(f"Wiersz {row_number}: plik zawiera powtórzoną pozycję „{name}”.")
        seen.add(key)
        items.append({
            "name": name,
            "quantity": quantity,
            "minimum": minimum,
            "unit": value_for("unit") or None,
            "location": value_for("location") or None,
        })
    if not items:
        raise ImportFileError("Nie znaleziono pozycji do zaimportowania.")
    return items


def _export_values(item: dict) -> list[str | int]:
    values: list[str | int] = []
    for _, field in EXPORT_COLUMNS:
        value = item.get(field, "")
        values.append("" if value is None else value)
    return values


def export_inventory_csv(items: list[dict]) -> bytes:
    """Write inventory rows as an Excel-friendly, UTF-8 Polish CSV."""
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", lineterminator="\r\n")
    writer.writerow([header for header, _ in EXPORT_COLUMNS])
    for item in items:
        writer.writerow(_export_values(item))
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def _column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def export_inventory_xlsx(items: list[dict]) -> bytes:
    """Write a minimal XLSX workbook that the inventory importer can read."""
    ET.register_namespace("", NS_MAIN_URI)
    worksheet = ET.Element(f"{NS_MAIN}worksheet")
    sheet_data = ET.SubElement(worksheet, f"{NS_MAIN}sheetData")

    rows = [[header for header, _ in EXPORT_COLUMNS]]
    for item in items:
        rows.append(_export_values(item))
    for row_number, values in enumerate(rows, start=1):
        row = ET.SubElement(sheet_data, f"{NS_MAIN}row", {"r": str(row_number)})
        for column_index, value in enumerate(values, start=1):
            cell = ET.SubElement(row, f"{NS_MAIN}c", {"r": f"{_column_name(column_index)}{row_number}"})
            if isinstance(value, int) and not isinstance(value, bool):
                ET.SubElement(cell, f"{NS_MAIN}v").text = str(value)
            else:
                cell.set("t", "inlineStr")
                inline = ET.SubElement(cell, f"{NS_MAIN}is")
                text = ET.SubElement(inline, f"{NS_MAIN}t")
                text.text = str(value)

    sheet_xml = ET.tostring(worksheet, encoding="utf-8", xml_declaration=True)
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Stany" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    workbook_relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )
    package_relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/></Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )

    with io.BytesIO() as output:
        with ZipFile(output, "w", ZIP_DEFLATED) as workbook:
            workbook.writestr("[Content_Types].xml", content_types)
            workbook.writestr("_rels/.rels", package_relationships)
            workbook.writestr("xl/workbook.xml", workbook_xml)
            workbook.writestr("xl/_rels/workbook.xml.rels", workbook_relationships)
            workbook.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        return output.getvalue()
