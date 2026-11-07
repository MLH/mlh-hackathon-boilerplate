"""Read inventory evidence, including cell fills and hyperlinks, without editing Excel."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as archive:
    strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
    styles = ET.fromstring(archive.read('xl/styles.xml'))
    fills = [ET.tostring(fill, encoding='unicode') for fill in styles.find('s:fills', NS)]
    formats = [int(style.get('fillId', '0')) for style in styles.find('s:cellXfs', NS)]
    result = {}
    for number in (3, 5):
        sheet = ET.fromstring(archive.read(f'xl/worksheets/sheet{number}.xml'))
        relpath = f'xl/worksheets/_rels/sheet{number}.xml.rels'
        relations = {r.get('Id'): r.get('Target') for r in ET.fromstring(archive.read(relpath))} if relpath in archive.namelist() else {}
        links = {link.get('ref'): relations.get(link.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')) for link in sheet.findall('s:hyperlinks/s:hyperlink', NS)}
        rows = []
        for row in sheet.findall('s:sheetData/s:row', NS):
            cells = {}
            for cell in row:
                value = cell.find('s:v', NS)
                value = value.text if value is not None else ''.join(cell.find('s:is', NS).itertext()) if cell.find('s:is', NS) is not None else ''
                if cell.get('t') == 's' and value:
                    value = strings[int(value)]
                if value:
                    address = cell.get('r')
                    cells[address] = {'value': value, 'fill': formats[int(cell.get('s', '0'))], 'link': links.get(address)}
            if cells:
                rows.append({'row': int(row.get('r')), 'cells': cells})
        result[str(number)] = rows
    result['fills'] = fills
    output = json.dumps(result, indent=2, ensure_ascii=False)
    if len(sys.argv) > 2:
        with open(sys.argv[2], 'w', encoding='utf-8') as target:
            target.write(output + '\n')
    else:
        print(output)
