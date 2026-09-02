# 📄 Dokumentenvorlagen

Serienbriefe ohne Word-Serienbrief. Eine `.docx`-Vorlage mit Platzhaltern wird
einmal hochgeladen; danach genügen zwei Klicks, um daraus für viele Empfänger
fertige Dokumente zu erzeugen — als ZIP zum Herunterladen oder gleich im
Downloadbereich für alle bereitgestellt.

**➡️ [Dokumentenvorlagen öffnen](https://sc1911heiligenstadt.github.io/dokumentenvorlagen/)**

## Wie es gedacht ist

1. **Vorlage wählen** — eine der hinterlegten `.docx`-Vorlagen.
2. **Empfänger wählen** — die Personen, für die Dokumente entstehen sollen.
   Filter nach Mannschaft, Lizenz, Vertrag, Führungszeugnis und Wohnort helfen
   dabei, genau die richtigen zu treffen.
3. **Dokumente erzeugen** — die Platzhalter werden ersetzt, das Ergebnis kommt
   als ZIP mit **Word-Dateien** zurück. Für originalgetreue PDFs laufen sie
   einmal durch das Word auf dem eigenen Rechner (siehe unten).
4. **Im Downloadbereich bereitstellen** — wenn die Dateien nicht nur zu dir,
   sondern zu den Empfängern sollen.

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Dokumente erstellen** | Die vier Schritte oben |
| **Vorlagen** | Vorhandene Vorlagen ansehen, neue hochladen — mit Anzeigename und Beschreibung. Dort steht auch die Liste der **verfügbaren Platzhalter** |
| **Einstellungen** | Trainerdaten-Zugriff und die Skripte für die PDF-Erzeugung |
| **Info** | Was das Werkzeug tut, die Änderungsliste und der Datenschutz-Hinweis |

## Die Platzhalter

Welche Platzhalter eine Vorlage kennt, steht im Reiter **Vorlagen**. Gefüllt
werden sie aus den zentralen Stammdaten — es wird also nichts doppelt gepflegt.
Die Schreibweise spielt keine Rolle: `{{Geburtsdatum}}` und `{{GEBURTSDATUM}}`
sind derselbe Platzhalter. Platzhalter, die Word intern in mehrere Textstücke
zerlegt hat, setzt das Werkzeug beim Erzeugen selbst wieder zusammen.

## PDFs

Das Werkzeug erzeugt Word-Dateien — im Browser gibt es keine verlässliche
Umwandlung nach PDF. Unter **Einstellungen** liegen ein PowerShell-Skript und
der Starter `pdf-erzeugen.bat` zum Herunterladen: beide in den entpackten
ZIP-Ordner legen, die `.bat` doppelklicken, danach liegen die PDFs neben den
Word-Dateien. Das läuft über das Word auf dem eigenen Rechner, die Daten
verlassen ihn dabei nicht.

## Bereitstellen

Die fertigen PDFs werden über ihren Dateinamen automatisch der richtigen Person
zugeordnet und landen bei ihr in der Tools-Übersicht unter *Mein Konto* — auf
Wunsch mit einer Meldung aufs Handy. Daneben gibt es **Dateien für alle** für
Merkblätter und Vordrucke. Die Liste **Liegt bereit** zeigt, wer ein Dokument
angesehen und wer es gespeichert hat, jeweils mit Datum. Bereitgestellt wird nur
PDF — eine Word-Datei mit Vereinsstempel wäre nachträglich änderbar.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen:

- **Sehen** — nur der Reiter *Info*. Weder Vorlagen noch das Erzeugen von
  Dokumenten sind sichtbar; der Katalog ist auch auf dem Server gesperrt.
- **Bearbeiten** — Vorlagen hochladen, umbenennen und löschen, Dokumente
  erzeugen und bereitstellen.
- **Administrieren** — zusätzlich der Reiter *Einstellungen*.

Adresse und Bankverbindung aus den Trainerdaten hängen an einem **eigenen**
Recht: der Stufe *Administrieren* für die App **Trainerdaten**. Das ist nicht
dasselbe wie das Administrieren dieses Werkzeugs und wird bei jedem Zugriff auf
dem Server geprüft; ein App-Passwort gibt es nicht mehr.

## Lokal starten

Über den Eintrag `dokumentenvorlagen` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8789/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser.

| Datei | Inhalt |
|---|---|
| `index.html` | die einzige Seite der App, alle Reiter |
| `app.js` | Ablauf, Filter, Erzeugen und Bereitstellen |
| `config.js` | Platzhalter-Katalog, Ortsgruppen, Änderungsliste |
| `db.js` | Anbindung an den Gateway-Worker |
| `docx-fill.js` | füllt die Platzhalter in der Word-Datei |
| `style.css` | Gestaltung |
| `docx-zu-pdf.ps1`, `pdf-erzeugen.bat` | die beiden Dateien für die PDF-Erzeugung auf dem eigenen Rechner |

Das Zusammenbauen der Dokumente läuft **lokal im Browser**. Die dafür nötige
ZIP-Bibliothek wird erst geladen, wenn wirklich erzeugt wird — beim Aufrufen der
Seite kostet sie nichts.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
