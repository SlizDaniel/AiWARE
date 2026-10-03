// Port of legacy/backend/tests/test_inventory_import.py and test_inventory_export.py
// at the adapter level (database upserts and HTTP shapes belong to the route/db
// tests), plus parity cases checked against the Python implementation.
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  FIELDS,
  ImportFileError,
  MAX_IMPORT_ROWS,
  MAX_UPLOAD_BYTES,
  REQUIRED_FIELDS,
  UPLOAD_TOO_LARGE_MESSAGE,
  exportInventoryCsv,
  exportInventoryXlsx,
  readInventoryFile,
  suggestMapping,
  unguardFormula,
  validateAndMapRows,
  type InventoryExportItem,
} from './inventory'
import type { ColumnMapping, ImportField, ImportedItem } from './types'

const utf8 = (text: string) => new TextEncoder().encode(text)
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../public/${name}`, import.meta.url)))
const columns = (mapping: ColumnMapping) =>
  Object.fromEntries(FIELDS.map((field) => [field, mapping[field].column])) as Record<ImportField, number | null>
const noMapping = (): Record<ImportField, number | null> => ({
  name: null,
  quantity: null,
  minimum: null,
  location: null,
  unit: null,
})

/** read → suggest → (optionally) validate, the way /api/import/preview + /confirm use the adapter. */
function preview(filename: string, data: Uint8Array) {
  const { headers, rows } = readInventoryFile(filename, data)
  const mapping = suggestMapping(headers)
  return { headers, rows, mapping, columns: columns(mapping) }
}

function importFile(filename: string, data: Uint8Array): ImportedItem[] {
  const { headers, rows, columns: mapping } = preview(filename, data)
  return validateAndMapRows(headers, rows, mapping)
}

function expectImportError(action: () => unknown, message: string) {
  expect(action).toThrow(ImportFileError)
  expect(action).toThrow(message)
}

const colName = (index: number): string => {
  let result = ''
  while (index) {
    const remainder = (index - 1) % 26
    index = Math.floor((index - 1) / 26)
    result = String.fromCharCode(65 + remainder) + result
  }
  return result
}

/** Port of the Python `xlsx_bytes` fixture: a tiny inlineStr workbook. */
function xlsxBytes(rows: string[][], options: { sheetXml?: string; extra?: Record<string, string> } = {}): Uint8Array {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map(
          (value, colIndex) =>
            `<c r="${colName(colIndex + 1)}${rowIndex + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
        )
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
    'xl/worksheets/sheet1.xml':
      options.sheetXml ??
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        sheetRows +
        '</sheetData></worksheet>',
    ...options.extra,
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))
}

const worksheet = (sheetData: string) =>
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`

// Seed-like stock (the Python export test round-tripped the seeded database).
const STOCK: InventoryExportItem[] = [
  { name: 'Kartony', quantity: 54, minimum: 12, location: 'Strefa A-1', unit: 'szt' },
  { name: 'Szkło', quantity: 20, minimum: 8, location: 'Strefa B-2', unit: 'szt' },
  { name: 'Folia stretch', quantity: 15, minimum: 6, location: 'Strefa C-1', unit: 'rolka' },
  { name: 'Taśma pakowa', quantity: 36, minimum: 10, location: 'Strefa A-2', unit: 'rolka' },
]

const TRICKY_STOCK: InventoryExportItem[] = [
  { name: 'Zażółć gęślą jaźń', quantity: 0, minimum: 0, location: 'Półka Ł-7', unit: 'kg' },
  { name: 'Taśma "mocna"; 5 cm, szara', quantity: 3, minimum: 1, location: 'Strefa Ż', unit: 'rolka' },
  { name: 'Klej <Super> & spółka', quantity: 1_000_000, minimum: 250, location: 'Paleta\nEUR', unit: 'ml' },
  { name: "Worki 'big'", quantity: 7, minimum: 2, location: '', unit: '' },
]

const asImported = (items: InventoryExportItem[]): ImportedItem[] =>
  items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    minimum: item.minimum,
    unit: item.unit || null,
    location: item.location || null,
  }))

describe('constants', () => {
  it('match the Python module (with the Vercel-sized upload limit)', () => {
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024)
    expect(UPLOAD_TOO_LARGE_MESSAGE).toBe('Plik jest za duży (limit 4 MB).')
    expect(MAX_IMPORT_ROWS).toBe(10_000)
    expect(REQUIRED_FIELDS).toEqual(['name', 'quantity'])
    expect(FIELDS).toEqual(['name', 'quantity', 'minimum', 'location', 'unit'])
    expect(new ImportFileError('x')).toBeInstanceOf(Error)
  })
})

describe('test_inventory_import.py (adapter level)', () => {
  it('CSV preview suggests Polish columns without writing', () => {
    const result = preview('magazyn.csv', utf8('Nazwa asortymentu;Stan [szt];Ilość minimalna;Lokalizacja\nKartony;54;12;Strefa A-1\n'))
    expect(result.rows).toHaveLength(1)
    expect(result.columns).toEqual({ name: 0, quantity: 1, minimum: 2, location: 3, unit: null })
    expect(result.mapping.name).toEqual({ column: 0, confidence: 0.96 })
  })

  it.each(['demo-magazyn.xlsx', 'demo-offline.xlsx'])('repository demo workbook %s uses Polish inventory headers', (name) => {
    const result = preview(name, fixture(name))
    expect(result.headers).toEqual(['Nazwa asortymentu', 'Stan [szt]', 'Ilość minimalna', 'Lokalizacja', 'Jednostka'])
    expect(result.rows).toHaveLength(4)
    expect(result.columns).toEqual({ name: 0, quantity: 1, minimum: 2, location: 3, unit: 4 })
  })

  it('demo-magazyn.xlsx yields the seeded stock', () => {
    expect(importFile('demo-magazyn.xlsx', fixture('demo-magazyn.xlsx'))).toEqual(asImported(STOCK))
    expect(readInventoryFile('demo-offline.xlsx', fixture('demo-offline.xlsx')).rows[0]).toEqual([
      'Kartony',
      '13',
      '12',
      'Strefa A-1',
      'szt',
    ])
  })

  it('XLSX mapping confirmation maps every row (re-import gives the same items)', () => {
    const body = xlsxBytes([
      ['Nazwa asortymentu', 'Stan [szt]', 'Minimum', 'Lokalizacja'],
      ['Kartony', '52', '12', 'Strefa A-1'],
      ['Nowy towar', '7', '3', 'Strefa C-2'],
    ])
    const { headers, rows, columns: mapping } = preview('magazyn.xlsx', body)
    expect(mapping).toEqual({ name: 0, quantity: 1, minimum: 2, location: 3, unit: null })
    const items = validateAndMapRows(headers, rows, mapping)
    expect(items).toEqual([
      { name: 'Kartony', quantity: 52, minimum: 12, unit: null, location: 'Strefa A-1' },
      { name: 'Nowy towar', quantity: 7, minimum: 3, unit: null, location: 'Strefa C-2' },
    ])
    expect(importFile('magazyn.xlsx', body)).toEqual(items)
  })

  it('CSV with Nazwa,Stan,Minimum,Jednostka (reorder-queue import) maps quantity, minimum and unit', () => {
    for (const [quantity, minimum] of [
      [10, 12],
      [10, 70],
      [20, 12],
      [20, 0],
    ]) {
      const result = preview('magazyn.csv', utf8(`Nazwa,Stan,Minimum,Jednostka\nKartony,${quantity},${minimum},szt\n`))
      expect(result.columns).toEqual({ name: 0, quantity: 1, minimum: 2, location: null, unit: 3 })
      expect(validateAndMapRows(result.headers, result.rows, result.columns)).toEqual([
        { name: 'Kartony', quantity, minimum, unit: 'szt', location: null },
      ])
    }
  })

  it('preview only reads; validation produces the rows to write on confirm', () => {
    const result = preview('items.csv', utf8('Nazwa,Ilość\nPozycja testowa,5\n'))
    expect(result.rows).toEqual([['Pozycja testowa', '5']])
    expect(validateAndMapRows(result.headers, result.rows, result.columns)).toEqual([
      { name: 'Pozycja testowa', quantity: 5, minimum: null, unit: null, location: null },
    ])
  })

  it('missing optional columns map to null so existing minimum/unit/location are preserved', () => {
    expect(importFile('items.csv', utf8('Nazwa,Ilość\nFolia stretch,14\n'))).toEqual([
      { name: 'Folia stretch', quantity: 14, minimum: null, unit: null, location: null },
    ])
  })

  it('missing required mapping is reported and cannot be confirmed', () => {
    const result = preview('items.csv', utf8('Opis,Uwagi\nKartony,do sprawdzenia\n'))
    const missingRequired = REQUIRED_FIELDS.filter((field) => result.mapping[field].column === null)
    expect(missingRequired).toEqual(['name', 'quantity'])
    expect(result.mapping.location.column).toBeNull()
    expectImportError(
      () => validateAndMapRows(result.headers, result.rows, noMapping()),
      'Wybierz kolumnę nazwy oraz ilości przed zatwierdzeniem importu.',
    )
  })

  it('an invalid row rejects the whole import', () => {
    const result = preview('items.csv', utf8('Nazwa,Ilość\nDobre,5\nZłe,nie-liczba\n'))
    expectImportError(
      () => validateAndMapRows(result.headers, result.rows, result.columns),
      'Wiersz 3: ilość „nie-liczba” nie jest liczbą całkowitą.',
    )
  })
})

describe('test_inventory_export.py (adapter level)', () => {
  it.each([
    ['csv', exportInventoryCsv],
    ['xlsx', exportInventoryXlsx],
  ] as const)('%s export round-trips through the importer without data loss', (format, exporter) => {
    const result = preview(`magazyn.${format}`, exporter(STOCK))
    expect(result.headers).toEqual(['Nazwa asortymentu', 'Ilość', 'Stan minimalny', 'Lokalizacja', 'Jednostka'])
    expect(result.columns).toEqual({ name: 0, quantity: 1, minimum: 2, location: 3, unit: 4 })
    expect(validateAndMapRows(result.headers, result.rows, result.columns)).toEqual(asImported(STOCK))
  })

  it.each([
    ['csv', exportInventoryCsv],
    ['xlsx', exportInventoryXlsx],
  ] as const)('%s export round-trips Polish characters, quotes, separators and markup', (format, exporter) => {
    const { headers, rows, columns: mapping } = preview(`magazyn.${format}`, exporter(TRICKY_STOCK))
    expect(rows[2][3]).toBe('Paleta\nEUR')
    expect(validateAndMapRows(headers, rows, mapping)).toEqual(asImported(TRICKY_STOCK))
  })

  it('round-trips an empty inventory to a header-only file', () => {
    for (const data of [exportInventoryCsv([]), exportInventoryXlsx([])]) {
      const name = data[0] === 0xef ? 'a.csv' : 'a.xlsx'
      expectImportError(
        () => readInventoryFile(name, data),
        'Plik musi zawierać nagłówki i przynajmniej jeden wiersz danych.',
      )
    }
  })
})

describe('exportInventoryCsv', () => {
  it('writes a UTF-8 BOM, semicolons, CRLF and quotes only when needed', () => {
    const bytes = exportInventoryCsv([
      { name: 'Taśma "mocna"; szara', quantity: 3, minimum: 1, location: 'A-1', unit: '' },
      { name: 'Kartony', quantity: 54, minimum: 12, location: 'Strefa A-1', unit: 'szt' },
    ])
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes)).toBe(
      'Nazwa asortymentu;Ilość;Stan minimalny;Lokalizacja;Jednostka\r\n' +
        '"Taśma ""mocna""; szara";3;1;A-1;\r\n' +
        'Kartony;54;12;Strefa A-1;szt\r\n',
    )
  })
})

describe('exportInventoryXlsx', () => {
  it('builds a complete minimal workbook package', () => {
    const files = unzipSync(exportInventoryXlsx(STOCK))
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ])
    const types = strFromU8(files['[Content_Types].xml'])
    expect(types).toContain('PartName="/xl/workbook.xml"')
    expect(types).toContain('PartName="/xl/worksheets/sheet1.xml"')
    expect(types).toContain('PartName="/xl/styles.xml"')
    expect(strFromU8(files['xl/workbook.xml'])).toContain('<sheet name="Stany" sheetId="1" r:id="rId1"/>')
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>Kartony</t></is></c><c r="B2"><v>54</v></c>')
  })

  it('escapes XML text and drops characters XML cannot carry', () => {
    const files = unzipSync(
      exportInventoryXlsx([{ name: 'A & B <c>\u0001', quantity: 1, minimum: 0, location: ' x ', unit: 'szt' }]),
    )
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('<t>A &amp; B &lt;c&gt;</t>')
    expect(sheet).toContain('<t xml:space="preserve"> x </t>')
  })
})

describe('readInventoryFile — CSV', () => {
  it('reads UTF-8 with and without BOM', () => {
    const text = 'Nazwa;Ilość\nKartony;5\n'
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)])
    expect(readInventoryFile('a.csv', withBom)).toEqual({ headers: ['Nazwa', 'Ilość'], rows: [['Kartony', '5']] })
    expect(readInventoryFile('a.csv', utf8(text))).toEqual({ headers: ['Nazwa', 'Ilość'], rows: [['Kartony', '5']] })
  })

  it('falls back to windows-1250 for legacy Excel CSV files', () => {
    // "Ilość;Miejsce składowania\nTaśma;5;Półka Ż" in cp1250
    const cp1250: Record<string, number> = { ś: 0x9c, ć: 0xe6, ł: 0xb3, ó: 0xf3, Ż: 0xaf }
    const encode = (text: string) => new Uint8Array([...text].map((ch) => cp1250[ch] ?? ch.charCodeAt(0)))
    const result = readInventoryFile('a.csv', encode('Nazwa;Ilość;Miejsce składowania\nTaśma;5;Półka Ż\n'))
    expect(result).toEqual({ headers: ['Nazwa', 'Ilość', 'Miejsce składowania'], rows: [['Taśma', '5', 'Półka Ż']] })
  })

  it('rejects bytes that are neither UTF-8 nor cp1250', () => {
    expectImportError(
      () => readInventoryFile('a.csv', new Uint8Array([...utf8('Nazwa;Ilo'), 0x81, ...utf8('\nA;1\n')])),
      'Nie udało się odczytać kodowania pliku CSV.',
    )
  })

  // Expected values produced by the Python implementation (csv.Sniffer parity).
  it.each([
    ['Nazwa|Ilość\nKarton|5\nTaśma|3\n', ['Nazwa', 'Ilość'], [['Karton', '5'], ['Taśma', '3']]],
    ['Nazwa\tIlość\tMiejsce\nKarton, duży\t5\tA-1\n', ['Nazwa', 'Ilość', 'Miejsce'], [['Karton, duży', '5', 'A-1']]],
    ['Nazwa,Ilość\n"Karton, duży",5\n"Taśma ""mocna""",3\n', ['Nazwa', 'Ilość'], [['Karton, duży', '5'], ['Taśma "mocna"', '3']]],
    ['Nazwa;Ilość\n"Paleta\nEUR";5\n', ['Nazwa', 'Ilość'], [['Paleta\nEUR', '5']]],
    ['Nazwa;Ilość\nKarton;5\n\n;\nTaśma;3\n', ['Nazwa', 'Ilość'], [['Karton', '5'], ['Taśma', '3']]],
    ['Nazwa;Ilość\r\nKarton;5\r\nTaśma;3\r\n', ['Nazwa', 'Ilość'], [['Karton', '5'], ['Taśma', '3']]],
    // Python quirk kept for parity: a blank CRLF line counts as a "\r" row for the sniffer.
    ['Nazwa;Ilość\r\nKarton;5\r\n\r\nTaśma;3\r\n', ['Nazwa;Ilość'], [['Karton;5'], ['Taśma;3']]],
    ['Nazwa\nKarton\nTaśma\n', ['Nazwa'], [['Karton'], ['Taśma']]],
    ["Nazwa;Ilość\n'Karton';5\n'Taśma';3\n", ['Nazwa', 'Ilość'], [['Karton', '5'], ['Taśma', '3']]],
    ['Nazwa, Ilość, Lokalizacja\nKarton, 5, A-1\nTaśma, 3, B-2\n', ['Nazwa', 'Ilość', 'Lokalizacja'], [['Karton', '5', 'A-1'], ['Taśma', '3', 'B-2']]],
    ['Nazwa;Ilość,x\nA;1,2\n', ['Nazwa;Ilość', 'x'], [['A;1', '2']]],
    // Inconsistent rows: the sniffer gives up and csv.excel (comma) is used.
    ['Nazwa;Ilość;Min\n\n;;\nKarton;5\nTaśma;3;1;extra\n', ['Nazwa;Ilość;Min'], [[';;'], ['Karton;5'], ['Taśma;3;1;extra']]],
  ])('sniffs %j like csv.Sniffer', (text, headers, rows) => {
    expect(readInventoryFile('a.csv', utf8(text))).toEqual({ headers, rows })
  })

  it('pads short rows and cuts long rows to the header width', () => {
    // Quoted names let the sniffer find ';' despite ragged rows (same as Python).
    expect(readInventoryFile('a.csv', utf8('Nazwa;Ilość;Min\n"A";1;2\n"B";2\n"C";3;4;5\n')).rows).toEqual([
      ['A', '1', '2'],
      ['B', '2', ''],
      ['C', '3', '4'],
    ])
  })

  it('treats a bare CR as a line break (Python raised csv.Error)', () => {
    expect(readInventoryFile('a.csv', utf8('Nazwa;Ilość\rKarton;5\rTaśma;3')).rows).toEqual([
      ['Karton', '5'],
      ['Taśma', '3'],
    ])
  })
})

describe('readInventoryFile — validation', () => {
  it('enforces the 4 MB limit', () => {
    expectImportError(() => readInventoryFile('a.csv', new Uint8Array(MAX_UPLOAD_BYTES + 1)), 'Plik jest za duży (limit 4 MB).')
  })

  it('accepts only CSV and XLSX (extension is case-insensitive)', () => {
    expectImportError(() => readInventoryFile('stany.xls', utf8('a')), 'Obsługiwane formaty plików to XLSX i CSV.')
    expectImportError(() => readInventoryFile('stany', utf8('a')), 'Obsługiwane formaty plików to XLSX i CSV.')
    expect(readInventoryFile('STANY.CSV', utf8('Nazwa;Ilość\nA;1\n')).rows).toEqual([['A', '1']])
    expect(readInventoryFile('Stany.XlSx', exportInventoryXlsx(STOCK)).rows).toHaveLength(4)
  })

  it('needs a header row and at least one data row', () => {
    expectImportError(() => readInventoryFile('a.csv', utf8('Nazwa;Ilość\n')), 'Plik musi zawierać nagłówki i przynajmniej jeden wiersz danych.')
    expectImportError(() => readInventoryFile('a.csv', utf8('')), 'Plik musi zawierać nagłówki i przynajmniej jeden wiersz danych.')
  })

  it('skips leading blank rows, so the first non-blank row is the header', () => {
    // Python kept blank XLSX rows and failed with "Nie znaleziono nagłówków kolumn.".
    expect(readInventoryFile('a.xlsx', xlsxBytes([[' ', ''], ['Nazwa', 'Ilość'], ['Kartony', '5']]))).toEqual({
      headers: ['Nazwa', 'Ilość'],
      rows: [['Kartony', '5']],
    })
  })

  it('limits the number of data rows', () => {
    const text = 'Nazwa;Ilość\n' + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i};1\n`).join('')
    expectImportError(() => readInventoryFile('a.csv', utf8(text)), 'Plik może zawierać maksymalnie 10000 wierszy danych.')
    expect(readInventoryFile('a.csv', utf8(text.slice(0, text.lastIndexOf('P')))).rows).toHaveLength(MAX_IMPORT_ROWS)
  })

  it('strips header whitespace but keeps raw data cells', () => {
    expect(readInventoryFile('a.csv', utf8(' Nazwa \u00a0;Ilość\n Kartony ;5\n'))).toEqual({
      headers: ['Nazwa', 'Ilość'],
      rows: [[' Kartony ', '5']],
    })
  })
})

describe('readInventoryFile — XLSX', () => {
  it('resolves shared strings (including rich-text runs) and numeric cells', () => {
    const body = xlsxBytes([], {
      sheetXml: worksheet(
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>54</v></c><c r="C2" t="s"><v>99</v></c></row>',
      ),
      extra: {
        'xl/sharedStrings.xml':
          '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<si><t>Nazwa</t></si><si><t>Ilość</t></si>' +
          '<si><r><rPr><b/></rPr><t>Taśma </t></r><r><t xml:space="preserve">&amp; folia</t></r></si></sst>',
      },
    })
    expect(readInventoryFile('a.xlsx', body)).toEqual({ headers: ['Nazwa', 'Ilość'], rows: [['Taśma & folia', '54']] })
  })

  it('places cells by reference and pads gaps', () => {
    const body = xlsxBytes([], {
      sheetXml: worksheet(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Nazwa</t></is></c><c r="C1" t="inlineStr"><is><t>Ilość</t></is></c></row>' +
          '<row r="3"><c r="c3"><v>7</v></c><c r="A3" t="inlineStr"><is><t>Kartony</t></is></c></row>',
      ),
    })
    expect(readInventoryFile('a.xlsx', body)).toEqual({ headers: ['Nazwa', '', 'Ilość'], rows: [['Kartony', '', '7']] })
  })

  it('follows workbook relationships to the first sheet', () => {
    const body = xlsxBytes([['Inny', 'Arkusz'], ['x', '1']], {
      extra: {
        'xl/workbook.xml':
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Stan" sheetId="2" r:id="rId7"/><sheet name="Inny" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/stan.xml"/>' +
          '</Relationships>',
        'xl/worksheets/stan.xml': worksheet(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>Nazwa</t></is></c><c r="B1" t="inlineStr"><is><t>Ilość</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>Kartony</t></is></c><c r="B2"><v>3</v></c></row>',
        ),
      },
    })
    expect(readInventoryFile('a.xlsx', body)).toEqual({ headers: ['Nazwa', 'Ilość'], rows: [['Kartony', '3']] })
  })

  it('reads namespace-prefixed parts, entities and CDATA', () => {
    const body = xlsxBytes([], {
      sheetXml:
        '<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- generator -->' +
        '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
        '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Nazwa</x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Ilo&#347;&#x107;</x:t></x:is></x:c></x:row>' +
        '<x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t><![CDATA[Tom & <Jerry>]]></x:t></x:is></x:c><x:c r="B2"><x:v>5</x:v></x:c></x:row>' +
        '</x:sheetData></x:worksheet>',
    })
    expect(readInventoryFile('a.xlsx', body)).toEqual({ headers: ['Nazwa', 'Ilość'], rows: [['Tom & <Jerry>', '5']] })
  })

  it('skips formatted rows without values', () => {
    const body = xlsxBytes([], {
      sheetXml: worksheet(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Nazwa</t></is></c><c r="B1" t="inlineStr"><is><t>Ilość</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Kartony</t></is></c><c r="B2"><v>5</v></c></row>' +
          '<row r="3"><c r="A3" s="1"/><c r="B3" s="1"/></row>',
      ),
    })
    expect(readInventoryFile('a.xlsx', body).rows).toEqual([['Kartony', '5']])
  })

  it('reports a workbook without its first sheet', () => {
    const files = unzipSync(xlsxBytes([['Nazwa'], ['x']]))
    delete files['xl/worksheets/sheet1.xml']
    expectImportError(() => readInventoryFile('a.xlsx', zipSync(files)), 'Arkusz kalkulacyjny nie zawiera czytelnej pierwszej karty.')
  })

  it.each([
    ['not a zip', utf8('Nazwa;Ilość\nKartony;5\n')],
    ['malformed sheet XML', xlsxBytes([], { sheetXml: '<worksheet><sheetData><row></sheetData></worksheet>' })],
    ['undefined entity', xlsxBytes([], { sheetXml: worksheet('<row r="1"><c r="A1" t="inlineStr"><is><t>&nbsp;</t></is></c></row>') })],
    ['broken shared strings', xlsxBytes([['a'], ['b']], { extra: { 'xl/sharedStrings.xml': '<sst><si>' } })],
  ])('rejects a corrupted workbook (%s)', (_, body) => {
    expectImportError(() => readInventoryFile('a.xlsx', body), 'Plik XLSX jest uszkodzony lub ma nieobsługiwany format.')
  })
})

describe('suggestMapping', () => {
  it('matches exact aliases after NFKD + diacritic stripping + casefold', () => {
    const mapping = suggestMapping(['ILOŚĆ', 'Nazwa produktu', 'Stan minimalny', 'Jednostka', 'Lokalizacja'])
    expect(columns(mapping)).toEqual({ name: 1, quantity: 0, minimum: 2, location: 4, unit: 3 })
    expect(Object.values(mapping).every((value) => value.confidence === 0.96)).toBe(true)
  })

  it('reserves exact matches before the fuzzy pass', () => {
    // "Stan minimalny" must not be consumed by the fuzzy "stan" alias for quantity.
    expect(columns(suggestMapping(['Stan minimalny', 'Stan', 'Towar']))).toEqual({
      name: 2,
      quantity: 1,
      minimum: 0,
      location: null,
      unit: null,
    })
  })

  it('falls back to fuzzy matches with lower confidence (ł does not decompose)', () => {
    const mapping = suggestMapping(['Nazwa towaru', 'Ilość na stanie', 'Miejsce składowania', 'Opis'])
    expect(mapping).toEqual({
      name: { column: 0, confidence: 0.78 },
      quantity: { column: 1, confidence: 0.78 },
      minimum: { column: null, confidence: 0 },
      location: { column: 2, confidence: 0.78 },
      unit: { column: null, confidence: 0 },
    })
  })

  it('understands English headings and ignores blank ones', () => {
    expect(columns(suggestMapping(['', 'Item name', 'Qty', 'Reorder point', 'Shelf', 'Unit']))).toEqual({
      name: 1,
      quantity: 2,
      minimum: 3,
      location: 4,
      unit: 5,
    })
  })

  it('never assigns one column twice and returns fields in Python order', () => {
    const mapping = suggestMapping(['Stan'])
    expect(Object.keys(mapping)).toEqual([...FIELDS])
    expect(columns(mapping)).toEqual({ name: null, quantity: 0, minimum: null, location: null, unit: null })
  })
})

describe('validateAndMapRows', () => {
  const headers = ['Nazwa', 'Ilość', 'Minimum', 'Lokalizacja', 'Jednostka']
  const mapping = { name: 0, quantity: 1, minimum: 2, location: 3, unit: 4 }
  const one = (row: string[]) => validateAndMapRows(headers, [row], mapping)[0]

  it('parses integers like Python int() after removing spaces', () => {
    expect(one(['A', '1 000', ' 12 ', '', '']).quantity).toBe(1000)
    expect(one(['A', '+4', '0', '', '']).quantity).toBe(4)
    expect(one(['A', '1_000', '', '', '']).quantity).toBe(1000)
    expect(one(['A', '٣', '１２', '', ''])).toMatchObject({ quantity: 3, minimum: 12 })
    expect(one(['A', '\u00a07\u00a0', '', '', '']).quantity).toBe(7)
    expect(one(['A', '-0', '', '', '']).quantity).toBe(0)
  })

  it.each([
    ['12.0', 'Wiersz 2: ilość „12.0” nie jest liczbą całkowitą.'],
    ['1,5', 'Wiersz 2: ilość „1,5” nie jest liczbą całkowitą.'],
    ['5,0', 'Wiersz 2: ilość „5,0” nie jest liczbą całkowitą.'],
    ['', 'Wiersz 2: ilość „” nie jest liczbą całkowitą.'],
    ['1\u00a0000', 'Wiersz 2: ilość „1\u00a0000” nie jest liczbą całkowitą.'],
    ['1__0', 'Wiersz 2: ilość „1__0” nie jest liczbą całkowitą.'],
  ])('rejects quantity %j', (quantity, message) => {
    expectImportError(() => one(['A', quantity, '', '', '']), message)
  })

  it('rejects bad minimum and negative values', () => {
    expectImportError(() => one(['A', '1', 'dużo', '', '']), 'Wiersz 2: minimum „dużo” nie jest liczbą całkowitą.')
    expectImportError(() => one(['A', '-1', '', '', '']), 'Wiersz 2: ilość i minimum nie mogą być ujemne.')
    expectImportError(() => one(['A', '1', '-2', '', '']), 'Wiersz 2: ilość i minimum nie mogą być ujemne.')
  })

  it('strips values and turns empty optional cells into null', () => {
    expect(one(['  Kartony ', '5', ' ', '\tStrefa A-1 ', ''])).toEqual({
      name: 'Kartony',
      quantity: 5,
      minimum: null,
      unit: null,
      location: 'Strefa A-1',
    })
  })

  it('requires a name in every row', () => {
    expectImportError(() => validateAndMapRows(headers, [['A', '1', '', '', ''], [' ', '1', '', '', '']], mapping), 'Wiersz 3: brak nazwy pozycji.')
  })

  it('rejects duplicate names case-insensitively (Python casefold)', () => {
    expectImportError(
      () => validateAndMapRows(headers, [['Kartony', '1', '', '', ''], ['KARTONY', '2', '', '', '']], mapping),
      'Wiersz 3: plik zawiera powtórzoną pozycję „KARTONY”.',
    )
    expectImportError(
      () => validateAndMapRows(headers, [['Straße', '1', '', '', ''], ['STRASSE', '2', '', '', '']], mapping),
      'Wiersz 3: plik zawiera powtórzoną pozycję „STRASSE”.',
    )
  })

  it('validates the mapping itself', () => {
    expectImportError(() => validateAndMapRows(headers, [], { ...mapping, minimum: 5 }), 'Nieprawidłowa kolumna dla pola „minimum”.')
    expectImportError(() => validateAndMapRows(headers, [], { ...mapping, unit: -1 }), 'Nieprawidłowa kolumna dla pola „unit”.')
    expectImportError(() => validateAndMapRows(headers, [], { ...mapping, name: 1.5 }), 'Nieprawidłowa kolumna dla pola „name”.')
    expectImportError(
      () => validateAndMapRows(headers, [], { ...mapping, quantity: null }),
      'Wybierz kolumnę nazwy oraz ilości przed zatwierdzeniem importu.',
    )
    expectImportError(() => validateAndMapRows(headers, [], { ...mapping, unit: 0 }), 'Każde pole musi być przypisane do innej kolumny.')
    expectImportError(() => validateAndMapRows(headers, [], mapping), 'Nie znaleziono pozycji do zaimportowania.')
  })

  it('treats missing mapping keys as unmapped', () => {
    const partial = { name: 0, quantity: 1 } as Record<ImportField, number | null>
    expect(validateAndMapRows(headers, [['A', '1', '9', 'x', 'y']], partial)).toEqual([
      { name: 'A', quantity: 1, minimum: null, unit: null, location: null },
    ])
  })
})

describe('integer range guard', () => {
  it('rejects quantities that do not fit a Postgres INTEGER column', () => {
    expect(() =>
      validateAndMapRows(['Nazwa', 'Ilość'], [['Kartony', '2147483648']], { name: 0, quantity: 1, minimum: null, location: null, unit: null }),
    ).toThrow('Wiersz 2: ilość i minimum nie mogą przekraczać 2147483647.')
  })
})

describe('CSV formula injection guard', () => {
  it('neutralises formula-like text on export and restores it on import', () => {
    const items = [
      { name: '=SUM(A1:A9)', quantity: 1, minimum: 0, unit: 'szt', location: '+A1' },
      { name: '-folia', quantity: 2, minimum: 1, unit: '@szt', location: 'Strefa A-1' },
    ]
    const csv = strFromU8(exportInventoryCsv(items))
    expect(csv).toContain("'=SUM(A1:A9)")
    expect(csv).toContain("'+A1")
    expect(csv).toContain("'-folia")
    expect(csv).not.toMatch(/(^|;)[=+@-]/m)
    const { headers, rows } = readInventoryFile('magazyn.csv', exportInventoryCsv(items))
    const mapped = validateAndMapRows(headers, rows, { name: 0, quantity: 1, minimum: 2, location: 3, unit: 4 })
    expect(mapped.map((item) => [item.name, item.location, item.unit])).toEqual([
      ['=SUM(A1:A9)', '+A1', 'szt'],
      ['-folia', 'Strefa A-1', '@szt'],
    ])
  })

  it('leaves ordinary apostrophes alone', () => {
    expect(unguardFormula("'Kartony")).toBe("'Kartony")
    expect(unguardFormula("'=1+1")).toBe('=1+1')
  })
})
