from pathlib import Path
from xml.sax.saxutils import escape
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'tmp/presentation/assets'
OUT=ROOT/'output/pdf/MAGAZYNIER-prezentacja-10-slajdow.pdf'
RENDER=ROOT/'tmp/presentation/render10'
RENDER.mkdir(parents=True,exist_ok=True)
for name,file in [('Segoe','segoeui.ttf'),('SegoeBold','segoeuib.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/file)))
pdfmetrics.registerFontFamily('Segoe',normal='Segoe',bold='SegoeBold',italic='Segoe',boldItalic='SegoeBold')
W,H=1280,720
INK='#182D26';GREEN='#315B45';MUTED='#59665F';BG='#F6F5EF';LINE='#D7DED5'
C=canvas.Canvas(str(OUT),pagesize=(W,H),pageCompression=1)
C.setTitle('MAGAZYNIER — agent AI w codziennej pracy magazynu | 10 slajdów')
C.setAuthor('Zespół MAGAZYNIER')

def p(text,x,y,w,size=22,bold=False,color=INK):
    st=ParagraphStyle('p',fontName='SegoeBold' if bold else 'Segoe',fontSize=size,leading=size*1.3,textColor=HexColor(color))
    para=Paragraph(text,st);_,h=para.wrap(w,H)
    assert y+h<=H-20,(C.getPageNumber(),text,y+h)
    para.drawOn(C,x,H-y-h)
    return h

def shot(name,x,y,bw,bh,crop=None):
    iw,ih=Image.open(ASSETS/name).size
    cx,cy,cw,ch=crop or (0,0,iw,ih)
    assert cx+cw<=iw and cy+ch<=ih
    scale=min(bw/cw,bh/ch);dw,dh=cw*scale,ch*scale
    dx=x+(bw-dw)/2;dy=H-y-(bh-dh)/2-dh
    C.saveState();clip=C.beginPath();clip.rect(dx,dy,dw,dh);C.clipPath(clip,stroke=0,fill=0)
    C.drawImage(str(ASSETS/name),dx-cx*scale,dy-(ih-cy-ch)*scale,width=iw*scale,height=ih*scale,mask='auto')
    C.restoreState()

def base(title,subtitle):
    C.setFillColor(HexColor(BG));C.rect(0,0,W,H,fill=1,stroke=0)
    n=C.getPageNumber();C.bookmarkPage(f'slide{n}');C.addOutlineEntry(title,f'slide{n}')
    p(title,60,43,1160,38,True)
    p(subtitle,60,101,1160,20,color=MUTED)
    C.setStrokeColor(HexColor(LINE));C.line(60,H-143,1220,H-143)

def blocks(items,x=820,y=178,w=395):
    for title,body in items:
        y+=p(escape(title),x,y,w,24,True)+9
        y+=p(escape(body),x,y,w,21,color=MUTED)+24
    assert y<=653,(C.getPageNumber(),y)

def end(note=''):
    if note:p(escape(note),60,668,1100,12,color=MUTED)
    C.setFillColor(HexColor(MUTED));C.setFont('Segoe',12);C.drawRightString(1220,20,f'{C.getPageNumber():02} / 10')
    C.showPage()

# 01: the product and problem, not an installation manual.
C.setFillColor(HexColor(GREEN));C.rect(0,0,W,H,fill=1,stroke=0)
p('MAGAZYNIER',66,71,900,64,True,'#FFFFFF')
p('Powiedz, co robisz.<br/>Agent porządkuje magazyn.',70,186,830,44,True,'#FFFFFF')
p('Głosowy agent AI łączy stany, lokalizacje, procedury<br/>i pracę zespołu w aplikacji webowej i mobilnej.',72,338,870,25,color='#DCE8DE')
p('Dla małych magazynów, w których Excel nie nadąża<br/>za wydaniami, a wiedza zostaje w głowach ludzi.',72,435,870,23,color='#DCE8DE')
C.drawImage(str(ROOT/'public/brand/mascot.jpg'),975,277,width=230,height=230,mask='auto')
p('AI proponuje. Człowiek sprawdza i zatwierdza.',72,573,1110,28,True,'#FFFFFF')
p('HackYeah 2026 · Open Task ARTIFICIAL INTELLIGENCE',72,657,1050,14,color='#DCE8DE')
C.setFillColor(HexColor('#DCE8DE'));C.setFont('Segoe',12);C.drawRightString(1220,20,'01 / 10');C.showPage()

# 02: import, all stock fields, search, edit, export.
base('Excel staje się wspólnym stanem magazynu','Wdrożenie zaczyna się od danych, które zespół już ma.')
shot('web-import-mapping.png',60,169,310,465,(285,20,610,635))
shot('web-edit.png',388,169,397,465,(285,85,615,625))
blocks([('Import XLSX / CSV','Agent sugeruje mapowanie kolumn. Kierownik sprawdza próbkę i zatwierdza import.'),('Towar w jednym widoku','Ilość, jednostka, minimum i lokalizacja. Wyszukiwanie, sortowanie oraz filtr braków.'),('Dane pod kontrolą','Kierownik poprawia produkty; zespół eksportuje aktualne stany do CSV lub XLSX.')])
end('Zrzuty rzeczywistego interfejsu na danych demonstracyjnych. Mapowanie AI korzysta z Gemini; tryb offline dopasowuje nazwy kolumn lokalnie.')

# 03: core magic moment.
base('Komenda po polsku → sprawdzona zmiana stanu','Wydania i przyjęcia można zgłosić głosem lub tekstem podczas pracy.')
shot('web-proposal.png',75,166,485,472,(930,265,315,438))
p('„Magu, wzięliśmy<br/>paletę kartonów”',603,172,607,34,True,color=GREEN)
blocks([('1. Agent przygotowuje kartę','W przykładzie: Kartony 13 → 11 szt. Widzisz produkt, ilość i wpływ na minimum.'),('2. Pracownik podejmuje decyzję','Zatwierdza lub odrzuca kartę przyciskiem albo głosem w aktywnym trybie nasłuchu.'),('3. Stan i historia są aktualizowane','Zapis następuje po zatwierdzeniu. Web i aplikacja mobilna korzystają ze wspólnej bazy.')],603,282,607)
end('W parserze demo paleta oznacza 2 jednostki. Przy realnym wydaniu podaj ilość i sprawdź ją na karcie przed zapisem.')

# 04: proactive replenishment, settings, queue.
base('Agent zauważa braki i proponuje uzupełnienie','Po zatwierdzonej zmianie sprawdza zapas względem ustalonego minimum.')
shot('web-queue.png',60,169,710,465,(285,160,610,490))
blocks([('Próg uruchamia propozycję','Kartony: 11 szt. przy minimum 12. W kolejce pojawia się szkic uzupełnienia o 50 szt.'),('Kierownik ustawia zasady','Minima produktów, domyślny próg nowych pozycji i proponowana wielkość zamówienia.'),('Kolejka porządkuje decyzje','Ilość, termin i status szkicu. Zatwierdzenie, odrzucenie i filtry oczekujących pozycji.')])
end('Zatwierdzenie szkicu zapisuje decyzję w aplikacji. Nie wysyła zamówienia dostawcy i nie zwiększa stanu towaru.')

# 05: both map clients and walking.
base('„Gdzie leży szkło?” → towar na mapie','Lokalizacje pomagają odnaleźć produkty i uporządkować przestrzeń hali.')
shot('web-map.png',60,169,650,389,(285,670,960,570))
shot('mobile-map.png',758,165,217,470)
p('Znajdź i sprawdź',1007,179,210,22,True)
p('Pytanie do agenta podświetla strefę. Kliknięcie pokazuje towary i ilości.',1007,221,210,20,color=MUTED)
p('Narysuj alejki',1007,357,210,22,True)
p('Spacer z telefonem: kroki, zakręty i skrzyżowania. Zapisz ścieżkę, dodaj sektor i przypisz towar.',1007,400,210,20,color=MUTED)
p('Strefy + sektory + zapisane przejścia',60,579,650,23,True)
p('Wspólny plan w webie i aplikacji. Dostępny także ręczny tryb rysowania.',60,616,665,19,color=MUTED)
end('Mobile: rzeczywisty podgląd klienta Expo Web. Wymiary alejek są szacowane; pracę czujników należy sprawdzić na fizycznym telefonie.')

# 06: institutional knowledge.
base('Wiedza o pakowaniu jest dostępna całemu zespołowi','„Jak pakujemy szkło?” przywołuje zapisaną procedurę i powiązane opakowanie.')
shot('web-procedures.png',60,169,710,465,(285,175,610,480))
blocks([('Jedna reguła dla produktu','Kierownik definiuje opakowanie, ilość na opakowanie i dodatkowe uwagi.'),('Instrukcja przy stanowisku','Wyszukiwanie lub pytanie do agenta: sposób pakowania, zasady przy brakach i uszkodzeniach.'),('Powiązanie ze stanami','Procedura pokazuje zapas powiązanego opakowania i prowadzi do lokalizacji towaru na mapie.')])
end('Pełne procedury są dostępne także w aplikacji mobilnej. Odczyt instrukcji nie odejmuje automatycznie produktu ani opakowań.')

# 07: assignment and roles.
base('Kierownik organizuje pracę, pracownik zna zadanie','Przydziały, priorytety i pomoc oparta na zapisanych procedurach.')
shot('web-tasks.png',60,169,700,370,(285,175,610,450))
p('Dostęp dopasowany do odpowiedzialności',60,562,715,23,True)
p('Rejestracja w webie → akceptacja przez kierownika → rola.<br/>Pracownik wykonuje własne zadania; kierownik zarządza zespołem.',60,603,715,20,color=MUTED)
blocks([('Przydział i priorytet','Kierownik wybiera pracownika, opisuje pracę i oznacza zadanie jako normalne lub pilne.'),('Widoczny postęp','Pracownik odczytuje i oznacza wykonanie własnego zadania. Kierownik widzi wszystkie i może anulować przydział.'),('„Jak wykonać?”','Pomoc wyszukuje procedury. W trybie AI Gemini układa kroki ze wskazaniem źródeł.')])
end('Zadania i zarządzanie rolami są w panelu webowym. Import, reguły, ustawienia, undo i decyzje zakupowe wymagają kierownika.')

# 08: overview, audit, undo, reports.
base('Pełny obraz magazynu i historia decyzji','Kierownik widzi, co wymaga reakcji. Każda zatwierdzona zmiana ma ślad w audycie.')
shot('web-dashboard-alert.png',60,169,580,383,(285,680,950,820))
shot('web-history.png',673,169,542,383,(285,125,610,590))
p('Dashboard i powiadomienia',60,572,580,23,True)
p('Braki, oczekujące szkice, lokalizacje i alerty.<br/>Raport okresowy, trend zapasu i przekazanie zmiany.',60,612,580,20,color=MUTED)
p('Audyt i cofnięcie pomyłki',673,572,542,23,True)
p('Kto, kiedy, co oraz stan przed i po.<br/>Undo kierownika dodaje osobny wpis korygujący.',673,612,542,20,color=MUTED)
end('Dziennik akcji ma filtry i eksport CSV. Oznaczenie alertu jako przeczytanego nie rozwiązuje braku towaru.')

# 09: mobile value with real UI, speech and settings.
base('Agent pod ręką — na hali i przy biurku','Web do organizacji pracy. Aplikacja mobilna do działania obok towaru.')
blocks([('Powiedz lub wpisz','Komenda po polsku, transkrypcja i karta zmiany. Nasłuch reaguje na ustawiony prefix, np. „Magu”.'),('Sprawdź bez wracania do biurka','Stany, mapa, historia, kolejka i procedury korzystają z tych samych danych co web.'),('Dopasuj sposób pracy','Mikrofon lub tekst, odczyt odpowiedzi głosem, prefix i tryb AI / offline w ustawieniach.')],60,176,440)
shot('mobile-command.png',542,169,212,463)
shot('mobile-proposal.png',777,169,212,463)
shot('mobile-settings.png',1012,169,212,463)
end('Screeny mobilne: Expo Web na danych demo. Funkcje głosowe zależą od mikrofonu i usług STT; tekst pozostaje dostępną alternatywą.')

# 10: complete story and accurate AI scope.
base('Od jednej komendy do uporządkowanej pracy magazynu','MAGAZYNIER łączy wykonanie operacji, wiedzę i nadzór kierownika.')
labels=[('POWIEDZ','Głos lub tekst'),('ZROZUM','Agent AI + narzędzia'),('SPRAWDŹ','Karta i zatwierdzenie'),('ZAPISZ','Stany + audyt')]
for j,(head,body) in enumerate(labels):
    x=60+j*300
    p(head,x,193,264,22,True,color=GREEN)
    p(body,x,232,264,22)
    if j<3:p('→',x+263,214,30,30,color=GREEN)
C.setStrokeColor(HexColor(LINE));C.line(60,H-306,1220,H-306)
blocks([('Codzienna praca','Import i eksport, wydania i przyjęcia, pytania o ilość i miejsce, mapa oraz procedury.')],60,345,342)
blocks([('Organizacja zespołu','Role, przydziały i priorytety, pomoc do zadań, alerty, raporty i przekazanie zmiany.')],460,345,342)
blocks([('Kontrola człowieka','Potwierdzenia zapisów, historia i undo kierownika. Szkice zakupowe czekają na decyzję.')],860,345,342)
p('Gemini interpretuje komendy, mapuje import i wspiera wykonanie zadań.<br/>Parser offline obsługuje rozpoznawane komendy bez LLM; demo wyłącza zewnętrzne API AI.',60,550,1160,21,color=MUTED)
p('github.com/SlizDaniel/AiWARE',60,629,1160,22,True,color=GREEN)
C.linkURL('https://github.com/SlizDaniel/AiWARE',(60,50,700,90),relative=0,thickness=0)
end('Web + aplikacja Expo · wspólna baza · uprawnienia sprawdzane przez backend · AI proponuje, człowiek zatwierdza.')
C.save()
reader=PdfReader(OUT)
assert len(reader.pages)==10
assert '\ufffd' not in '\n'.join(pg.extract_text() for pg in reader.pages)
doc=pdfium.PdfDocument(OUT)
for i in range(len(doc)):
    doc[i].render(scale=1).to_pil().save(RENDER/f'page-{i+1:02}.png')
print(f'Created and rendered {len(reader.pages)} slides: {OUT}')
