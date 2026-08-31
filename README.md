# 📄 Dokumentenvorlagen

Serienbriefe ohne Word-Serienbrief. Eine `.docx`-Vorlage mit Platzhaltern wird
einmal hochgeladen; danach genügen zwei Klicks, um daraus für viele Empfänger
fertige Dokumente zu erzeugen — als ZIP zum Herunterladen oder gleich im
Downloadbereich für alle bereitgestellt.

**➡️ [Dokumentenvorlagen öffnen](https://sc1911heiligenstadt.github.io/dokumentenvorlagen/)**

## Wie es gedacht ist

1. **Vorlage wählen** — eine der hinterlegten `.docx`-Vorlagen.
2. **Empfänger wählen** — die Personen, für die Dokumente entstehen sollen.
3. **Dokumente erzeugen** — die Platzhalter werden ersetzt, das Ergebnis kommt
   als Paket zurück. Auf Wunsch entsteht dabei direkt ein PDF.
4. **Im Downloadbereich bereitstellen** — wenn die Dateien nicht nur zu dir,
   sondern zu allen sollen.

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Dokumente erstellen** | Die vier Schritte oben |
| **Vorlagen** | Vorhandene Vorlagen ansehen, neue hochladen — mit Anzeigename und Beschreibung. Dort steht auch die Liste der **verfügbaren Platzhalter** |
| **Einstellungen** | Trainerdaten-Zugriff und Verwaltung |

## Die Platzhalter

Welche Platzhalter eine Vorlage kennt, steht im Reiter **Vorlagen**. Gefüllt
werden sie aus den zentralen Stammdaten — es wird also nichts doppelt gepflegt.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen: **Sehen** (Vorlagen ansehen), **Bearbeiten**
(Dokumente erzeugen) und **Administrieren** (Vorlagen hochladen und pflegen,
Reiter *Einstellungen*). Wer welche Stufe hat, legt die Tools-Übersicht fest.

## Lokal starten

Über den Eintrag `dokumentenvorlagen` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8789/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser.

Das Zusammenbauen der Dokumente läuft **lokal im Browser**. Die dafür nötige
ZIP-Bibliothek wird erst geladen, wenn wirklich erzeugt wird — beim Aufrufen der
Seite kostet sie nichts.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
