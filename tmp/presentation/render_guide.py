from pathlib import Path
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parents[2]
p=root/'output/pdf/MAGAZYNIER-przewodnik-web-mobile.pdf'
dest=root/'tmp/presentation/render';dest.mkdir(parents=True,exist_ok=True)
doc=pdfium.PdfDocument(p)
for i in range(len(doc)):
    page=doc[i];im=page.render(scale=1).to_pil();im.save(dest/f'page-{i+1:02}.png')
for start in range(0,len(doc),8):
    thumbs=[]
    for i in range(start,min(start+8,len(doc))):
        im=Image.open(dest/f'page-{i+1:02}.png');im.thumbnail((640,360));tile=Image.new('RGB',(640,390),'white');tile.paste(im,(0,25));ImageDraw.Draw(tile).text((8,4),f'{i+1:02}',fill='black');thumbs.append(tile)
    sheet=Image.new('RGB',(1280,390*((len(thumbs)+1)//2)),'#ddd')
    for j,im in enumerate(thumbs):sheet.paste(im,((j%2)*640,(j//2)*390))
    sheet.save(dest/f'contact-{start//8+1}.jpg',quality=95)
reader=PdfReader(p)
text='\n'.join(page.extract_text() for page in reader.pages)
assert len(reader.pages)==41
assert '\ufffd' not in text
assert all(word in text for word in ['Rejestracja','Kierownik','Procedury','Expo','Zatwierdź'])
print('Pages:',len(reader.pages),'| Text and Polish characters OK | Bytes:',p.stat().st_size)
