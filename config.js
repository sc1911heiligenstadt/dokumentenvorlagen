// Dokumentenvorlagen — zentrales Serienbrief-/Vorlagen-Tool.
// Vanilla JS, kein Build-Step. Muster übernommen von E:\Trainerdaten + E:\TrainerCheckliste.

const APP_VERSION = "1.0";

// ─── Zentraler Login-Gateway (ToolsUebersicht) ────────────────────────────────
// Gleiches Token-Muster wie alle Gateway-Apps: Login-Token liegt im localStorage
// der Origin sc1911heiligenstadt.github.io, der landingpage-Worker prüft Token + Tool-
// Sichtbarkeit und greift serverseitig auf Nextcloud zu.
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";
const GATEWAY_APP_ID = "dokumentenvorlagen";

// ─── Admin-Datenzugriff auf Trainerdaten (inkl. IBAN) ─────────────────────────
// Wie der Trainerdaten-Admin seit dem Rechte-Umbau (2026-07-23): trainerdaten.json
// wird read-only über den Trainerdaten-CORS-Proxy gelesen, der den ToolsUebersicht-
// Login-Token verlangt und serverseitig die Administrieren-Stufe für Trainerdaten
// prüft (seit der dritten Rechte-Stufe 2026-07-24; kein App-Passwort mehr im
// Client, Nextcloud-Zugang als Worker-Secret — siehe cors-proxy-worker.js in
// Trainerdaten). Die IBAN bleibt im Browser und läuft nie über das zentrale
// Gateway.
const TRAINERDATEN_WEBDAV_URL =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/" +
  "05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/Trainerdaten/trainerdaten.json";
const CORS_PROXY_DEFAULT_URL = "https://trainerdaten.michel-brunner.workers.dev";

// Größenlimit pro hochgeladener Vorlage (.docx sind klein; großzügig gedeckelt).
const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024; // 8 MB

// Katalog der bekannten Platzhalter. `quelle` steuert nur die Vorschau-Gruppierung
// ("profil" = aus dem zentralen Trainerprofil verfügbar, "trainerdaten" = nur mit
// Admin-Datenzugriff, "auto" = vom Tool selbst gesetzt). Eine Vorlage darf beliebige
// dieser Platzhalter als {{KEY}} enthalten; unbekannte Platzhalter werden beim
// Hochladen erkannt und als "manuell auszufüllen" markiert.
const PLATZHALTER_FELDER = [
  { key: "VORNAME",      label: "Vorname",              quelle: "profil" },
  { key: "NACHNAME",     label: "Nachname",             quelle: "profil" },
  { key: "MANNSCHAFT",   label: "Mannschaft(en)",       quelle: "profil" },
  { key: "LIZENZ",       label: "Lizenz",               quelle: "profil" },
  { key: "GEBURTSDATUM", label: "Geburtsdatum",         quelle: "trainerdaten" },
  { key: "STRASSE",      label: "Straße & Hausnummer",  quelle: "trainerdaten" },
  { key: "PLZ",          label: "PLZ",                  quelle: "trainerdaten" },
  { key: "ORT",          label: "Ort",                  quelle: "trainerdaten" },
  { key: "PLZ_ORT",      label: "PLZ + Ort",            quelle: "trainerdaten" },
  { key: "TELEFON",      label: "Telefon",              quelle: "trainerdaten" },
  { key: "EMAIL",        label: "E-Mail",               quelle: "trainerdaten" },
  { key: "IBAN",         label: "IBAN",                 quelle: "trainerdaten" },
  { key: "BANKNAME",     label: "Bankname",             quelle: "trainerdaten" },
  { key: "BIC",          label: "BIC",                  quelle: "trainerdaten" },
  { key: "PAUSCHALE",    label: "Pauschale (EUR)",      quelle: "trainerdaten" },
  { key: "DATUM",        label: "Datum (heute)",        quelle: "auto" },
  { key: "JAHR",         label: "Jahr (aktuell)",       quelle: "auto" }
];

// Schnell-Lookup key -> Felddefinition.
const PLATZHALTER_MAP = Object.fromEntries(PLATZHALTER_FELDER.map(f => [f.key, f]));

const APP_CHANGELOG = [
  {
    version: "1.1",
    groups: [
      {
        title: "Fertige Dokumente im Downloadbereich bereitstellen",
        items: [
          "Neuer Schritt 4 unter „Dokumente erzeugen“: Die fertigen PDFs auswählen — jede Datei wird über ihren Namen automatisch der richtigen Person zugeordnet und landet bei ihr in der Tools-Übersicht unter „Mein Konto“.",
          "Der Weg dahin: Dokumente erzeugen (ZIP), entpacken, darin „pdf-erzeugen.bat“ doppelklicken — dann die PDFs hier hochladen. So sieht das Ergebnis genau aus wie die Word-Vorlage, mit Briefkopf und Logo.",
          "Neu dafür: Im Tab „Einstellungen“ gibt es jetzt einen Starter zum Herunterladen. Ein PowerShell-Skript startet Windows per Doppelklick nämlich nicht — es öffnet nur den Editor. Beide Dateien in den entpackten Ordner legen, dann reicht ein Doppelklick.",
          "Vor dem Bereitstellen steht die Zuordnung untereinander: Was passt, was keiner Person zuzuordnen ist und wer kein Konto in der Tools-Übersicht hat. Nur das Passende geht raus.",
          "Auf Wunsch bekommt die Person eine Meldung aufs Handy, und am Tab „Mein Konto“ erscheint eine kleine rote Zahl.",
          "Darunter neu: „Dateien für alle bereitstellen“ — Merkblätter und Vordrucke, die jeder Angemeldete sehen soll. Und die Liste „Liegt bereit“ mit einem Knopf zum Entfernen.",
          "Bereitgestellt wird nur PDF. Eine Word-Datei mit Vereinsstempel wäre nachträglich änderbar."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Serienbrief aus Word-Vorlagen",
        items: [
          "Vorlagen-Katalog: Word-Dokumente mit Platzhaltern wie {{VORNAME}} hochladen, benennen, beschreiben und wieder löschen. Der Katalog liegt zentral, alle Berechtigten sehen dieselbe Auswahl.",
          "Beim Hochladen erkennt das Werkzeug von selbst, welche Platzhalter eine Vorlage enthält.",
          "Eine Vorlage lässt sich mit beliebig vielen Empfängern befüllen; alle fertigen Dokumente kommen zusammen als ZIP-Datei heraus.",
          "Für originalgetreue PDFs liegt ein Skript bei, das einen Ordner voller erzeugter Word-Dateien lokal über Microsoft Word als PDF exportiert."
        ]
      },
      {
        title: "Woher die Daten kommen",
        items: [
          "Empfänger wahlweise aus dem zentralen Trainerprofil mit Name, Lizenz und Mannschaft — oder aus den Trainerdaten, dann zusätzlich mit Adresse und Bankverbindung.",
          "Ist der Zugriff auf die Trainerdaten vorhanden, wird diese Quelle beim Öffnen von selbst vorgewählt. Straße, PLZ, Ort und Bankverbindung sind dann sofort da.",
          "Der Zugriff auf Adresse und Bankverbindung verlangt die Stufe „Administrieren“ für die Trainerdaten — dieselbe Stufe, an der auch deren Verwaltungsbereich hängt. Geprüft wird das bei jedem Zugriff auf dem Server.",
          "Im Reiter „Vorlagen“ steht eine Übersicht aller verfügbaren Platzhalter, gruppiert nach Quelle. Ein Klick kopiert einen Platzhalter in die Zwischenablage, von wo er direkt in die Word-Vorlage wandert."
        ]
      },
      {
        title: "Empfänger filtern",
        items: [
          "Über der Empfängerliste stehen vier Filter: Mannschaft, Lizenz, Vertrag und Führungszeugnis. Damit geht eine Vorlage gezielt an die Personen, die sie wirklich brauchen.",
          "Beispiel Übungsleitervertrag: der Filter „Vertrag = noch keiner bereitgestellt“ zeigt genau die, die noch keinen bekommen haben.",
          "Beispiel Führungszeugnis: der Filter „noch keins hinterlegt“ überspringt alle, die ihres bereits eingereicht haben.",
          "Filter lassen sich kombinieren und mit dem Suchfeld verbinden. „Alle“ wählt dann nur die gerade angezeigten Empfänger.",
          "Mannschaft und Lizenz füllen sich aus den geladenen Daten, einschließlich der Einträge „ohne Mannschaft“ und „ohne Lizenz“.",
          "Vertrag und Führungszeugnis stammen aus den Trainerdaten und stehen deshalb nur bei dieser Datenquelle zur Verfügung.",
          "Bleiben ausgewählte Empfänger durch einen Filter ausgeblendet, weist die Zeile unter der Liste ausdrücklich darauf hin — sie bekommen trotzdem ein Dokument."
        ]
      },
      {
        title: "Was nicht gespeichert wird",
        items: [
          "In der Cloud liegt nur der Katalog mit den leeren Vorlagen.",
          "Die ausgefüllten Dokumente entstehen im Browser und werden direkt heruntergeladen. Sie werden nie in der Cloud abgelegt — Bankdaten verlassen das eigene Gerät nicht."
        ]
      },
      {
        title: "Wer darf was",
        items: [
          "Das Werkzeug ist Bearbeitern vorbehalten. Wer es nur sehen darf, sieht ausschließlich den Reiter „Info“ — weder die Vorlagenverwaltung noch das Erstellen von Dokumenten.",
          "Bearbeiten: Vorlagen hochladen, umbenennen und löschen sowie Dokumente erstellen.",
          "Adresse und Bankverbindung aus den Trainerdaten setzen zusätzlich die Stufe „Administrieren“ für die Trainerdaten voraus.",
          "Der Vorlagen-Katalog ist auch auf dem Server auf Bearbeiter beschränkt, nicht nur am Bildschirm."
        ]
      },
      {
        title: "Bedienung am Handy",
        items: [
          "Die Ansicht funktioniert am Handy; für das Zusammenstellen von Serienbriefen ist ein Rechner allerdings die bequemere Wahl.",
          "Eingabefelder sind mindestens 16 Pixel groß, damit der iPhone-Browser beim Antippen nicht ungefragt in die Seite hineinzoomt und verschoben stehen bleibt.",
          "Das Hochladen einer Vorlage funktioniert auch auf älteren iPhones und iPads: die interne Datei-Kennung wird notfalls selbst im geforderten Format erzeugt. Zuvor brach der Upload dort mit einer Fehlermeldung ab."
        ]
      }
    ]
  }
];
