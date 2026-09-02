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

// ─── Ortsgruppen für den Wohnort-Filter ───────────────────────────────────────
// Wozu: Beim erweiterten Führungszeugnis zählt nicht der Ortsname, sondern die
// zuständige MELDEBEHÖRDE. Die zehn Ortsteile unten sind Teil der Stadt Heilbad
// Heiligenstadt (Bischhagen, Glasehausen, Mengelrode, Siemerode und Streitholz
// seit dem 01.01.2024 eingemeindet) — für sie ist dasselbe Meldeamt zuständig,
// sie werden also zentral beantragt und brauchen das Vereinsschreiben nicht.
//
// Ein Ortsteil taucht im Filter deshalb NICHT einzeln auf; ein Haken auf der
// Gruppe fasst alle mit. Welche Ortsteile in den geladenen Daten wirklich
// vorkommen, steht klein unter dem Gruppennamen.
//
// ⚠️ „Bernterode" ist im Eichsfeld nicht eindeutig — es gibt Bernterode bei
// Heiligenstadt (hier gemeint) UND Bernterode bei Worbis, das zu einer anderen
// Verwaltungsgemeinschaft gehört. Steht in den Trainerdaten nur „Bernterode",
// landet auch letzteres in dieser Gruppe. Wer beide im Bestand hat, muss den
// Datensatz präzisieren („Bernterode bei Worbis") und den Namen hier ergänzen.
const ORT_GRUPPEN = [
  {
    name: "Heilbad Heiligenstadt",
    orte: [
      "Heilbad Heiligenstadt", "Heiligenstadt",
      "Bernterode", "Bischhagen", "Flinsberg", "Glasehausen", "Günterode",
      "Kalteneber", "Mengelrode", "Rengelrode", "Siemerode", "Streitholz"
    ]
  }
];

const APP_CHANGELOG = [
  {
    version: "1.0",
    groups: [
      {
        title: "Serienbrief aus Word-Vorlagen",
        items: [
          "Vorlagen-Katalog: Word-Dokumente mit Platzhaltern wie {{VORNAME}} hochladen, benennen, beschreiben und wieder löschen. Der Katalog liegt zentral, alle Berechtigten sehen dieselbe Auswahl.",
          "Beim Hochladen erkennt das Werkzeug von selbst, welche Platzhalter eine Vorlage enthält. Die Schreibweise ist dabei egal: {{Geburtsdatum}}, {{geburtsdatum}} und {{GEBURTSDATUM}} sind derselbe Platzhalter.",
          "Word verteilt einen am Stück getippten Platzhalter intern manchmal auf mehrere Textstücke. Das Werkzeug setzt ihn beim Erzeugen selbst wieder zusammen; die hochgeladene Datei bleibt unangetastet. Nur wenn wirklich etwas dazwischenliegt, das sich nicht überbrücken lässt, erscheint eine Warnung.",
          "Unter „Vorlagen“ liest der Knopf „Platzhalter neu einlesen“ die Liste frisch aus dem Dokument — nützlich bei Vorlagen, die schon länger im Katalog liegen.",
          "Ein Platzhalter, den das Werkzeug nicht kennt, bleibt sichtbar im Dokument stehen. Ein Fehler fällt so auf, statt still ein leeres Feld zu hinterlassen.",
          "Eine Vorlage lässt sich mit beliebig vielen Empfängern befüllen; alle fertigen Dokumente kommen zusammen als ZIP-Datei heraus. Eine Vorschau zeigt vorher, was herauskommt.",
          "Das Werkzeug erzeugt Word-Dateien — im Browser gibt es keine verlässliche Umwandlung nach PDF. Für originalgetreue PDFs liegen unter „Einstellungen“ ein Skript und ein Starter zum Herunterladen: beide in den entpackten Ordner legen, „pdf-erzeugen.bat“ doppelklicken, fertig. Das läuft über das Word auf dem eigenen Rechner, die Daten verlassen ihn dabei nicht."
        ]
      },
      {
        title: "Woher die Daten kommen",
        items: [
          "Empfänger wahlweise aus dem zentralen Trainerprofil mit Name, Lizenz und Mannschaft — oder aus den Trainerdaten, dann zusätzlich mit Adresse und Bankverbindung.",
          "Der Zugriff auf Adresse und Bankverbindung verlangt die Stufe „Administrieren“ für die Trainerdaten — dieselbe Stufe, an der auch deren Verwaltungsbereich hängt. Geprüft wird das bei jedem Zugriff auf dem Server, ein App-Passwort gibt es nicht.",
          "Ist dieser Zugriff vorhanden, wird die Quelle „Trainerdaten“ beim Öffnen von selbst vorgewählt. Straße, PLZ, Ort und Bankverbindung sind dann sofort da.",
          "Im Reiter „Vorlagen“ steht eine Übersicht aller verfügbaren Platzhalter, gruppiert nach Quelle. Ein Klick kopiert einen Platzhalter in die Zwischenablage, von wo er direkt in die Word-Vorlage wandert."
        ]
      },
      {
        title: "Empfänger filtern",
        items: [
          "Über der Empfängerliste stehen die Filter Mannschaft, Lizenz, Vertrag, Führungszeugnis und Wohnort. Damit geht eine Vorlage gezielt an die Personen, die sie wirklich brauchen.",
          "Beispiel Übungsleitervertrag: „Vertrag = noch keiner bereitgestellt“ zeigt genau die, die noch keinen bekommen haben. Beispiel Führungszeugnis: „noch keins hinterlegt“ überspringt alle, die ihres bereits eingereicht haben — und lässt Personen aus, für die gar kein Vertrag vorgesehen ist (Status „Nur Kontaktdaten“).",
          "Der Wohnort-Filter arbeitet mit Häkchen, es lassen sich also mehrere Orte auf einmal wählen; hinter jedem Ort steht, wie viele Personen dort wohnen. Der Knopf „Umkehren“ ist der kurze Weg zu „alle außer Heiligenstadt“ — gedacht für das erweiterte Führungszeugnis, das außerhalb beim eigenen Meldeamt beantragt werden muss.",
          "Die zehn Ortsteile von Heilbad Heiligenstadt stehen nicht einzeln in der Liste, sondern stecken in der Gruppe „Heilbad Heiligenstadt“, weil für sie dasselbe Meldeamt zuständig ist. Alle zehn sind klein unter dem Namen aufgeführt, auch wenn dort gerade niemand wohnt.",
          "Verschiedene Schreibweisen desselben Ortes fallen zu einer Zeile zusammen: „37308 Heiligenstadt“ und „Heilbad Heiligenstadt“, ebenso „Mühlhausen“ und „Muehlhausen“ oder „Weißensee“ und „Weissensee“. Sonst erwischte ein Haken nur einen Teil der Leute.",
          "Filter lassen sich kombinieren und mit dem Suchfeld verbinden. „Alle“ wählt dann nur die gerade angezeigten Empfänger. Bleiben ausgewählte Empfänger durch einen Filter ausgeblendet, weist die Zeile unter der Liste ausdrücklich darauf hin — sie bekommen trotzdem ein Dokument.",
          "Vertrag, Führungszeugnis und Wohnort stammen aus den Trainerdaten und stehen deshalb nur bei dieser Datenquelle zur Verfügung."
        ]
      },
      {
        title: "Fertige Dokumente bereitstellen",
        items: [
          "Schritt 4 unter „Dokumente erstellen“: Die fertigen PDFs auswählen — jede Datei wird über ihren Namen automatisch der richtigen Person zugeordnet und landet bei ihr in der Tools-Übersicht unter „Mein Konto“.",
          "Vor dem Bereitstellen steht die Zuordnung untereinander: was passt, was keiner Person zuzuordnen ist und wer kein Konto in der Tools-Übersicht hat. Nur das Passende geht raus. Der Anzeigename kommt aus dem Dateinamen, nicht aus der gerade oben gewählten Vorlage.",
          "Auf Wunsch bekommt die Person eine Meldung aufs Handy, und am Reiter „Mein Konto“ erscheint eine kleine rote Zahl. Aufs Handy kommt die Meldung nur bei dem, der die Tools-Übersicht als App abgelegt und Benachrichtigungen eingeschaltet hat — die rote Zahl kommt in jedem Fall.",
          "„Dateien für alle bereitstellen“ ist für Merkblätter und Vordrucke gedacht, die jeder Angemeldete sehen soll.",
          "Die Liste „Liegt bereit“ zeigt unter jedem Dokument, ob der Empfänger es angesehen und ob er es gespeichert hat, jeweils mit Datum und Uhrzeit; bei mehrfachem Hineinsehen steht die Anzahl dabei. Bei Dateien „für alle“ steht die Zahl der Personen, wer genau, steht im Aufklapper darunter. Das ersetzt das Nachfragen, ob ein Vertrag oder ein Behördenschreiben angekommen ist.",
          "Gezählt wird nur der Klick des Empfängers. Wer verteilen darf und selbst hineinsieht, taucht nicht auf. Was jemand danach im PDF-Betrachter tut, sieht die App nicht — deshalb steht dort „angesehen“ und nicht „gelesen“.",
          "Bereitgestellt wird nur PDF. Eine Word-Datei mit Vereinsstempel wäre nachträglich änderbar."
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
          "Bearbeiten: Vorlagen hochladen, umbenennen und löschen sowie Dokumente erstellen und bereitstellen.",
          "Administrieren: zusätzlich der Reiter „Einstellungen“ mit dem Trainerdaten-Zugriff und den Skripten für die PDF-Erzeugung.",
          "Adresse und Bankverbindung aus den Trainerdaten setzen die Stufe „Administrieren“ für die Trainerdaten voraus — das ist ein eigenes Recht in der Tools-Übersicht, nicht dasselbe wie das Administrieren dieses Werkzeugs.",
          "Der Vorlagen-Katalog ist auch auf dem Server auf Bearbeiter beschränkt, nicht nur am Bildschirm."
        ]
      },
      {
        title: "Bedienung am Handy",
        items: [
          "Die Ansicht funktioniert am Handy; für das Zusammenstellen von Serienbriefen ist ein Rechner allerdings die bequemere Wahl.",
          "Eingabefelder sind mindestens 16 Pixel groß, damit der iPhone-Browser beim Antippen nicht ungefragt in die Seite hineinzoomt und verschoben stehen bleibt.",
          "Das Hochladen einer Vorlage funktioniert auch auf älteren iPhones und iPads: die interne Datei-Kennung wird notfalls selbst im geforderten Format erzeugt."
        ]
      }
    ]
  }
];
