// Kern: Word-.docx-Vorlagen mit {{PLATZHALTER}} befüllen (rein clientseitig, JSZip).
// Extrahiert und generalisiert aus E:\Trainerdaten\pdf-utils.js generiereVertragDocx()
// — inkl. der bewährten Gotchas: slash-robuster ZIP-Lookup, XML-Escaping.
//
// Robustheit gegen Word-„Split-Runs": Word kann einen am Stück getippten Platzhalter
// intern über mehrere <w:t>-Runs verteilen (z. B. wenn die Rechtschreibprüfung oder
// eine Formatänderung reinfunkt). Eine solche gesplittete {{...}}-Sequenz lässt sich
// per einfacher String-Ersetzung NICHT treffen. Wir reparieren das nicht heimlich
// (das Umschreiben der XML-Runs birgt Korruptionsrisiko), sondern ERKENNEN es beim
// Hochladen und warnen — der Nutzer tippt den Platzhalter dann im Word einmal am
// Stück neu. `analyzeTemplate()` liefert dafür getrennt: erkannte, ersetzbare und
// (nur erkannt, aber nicht ersetzbar =) gesplittete Platzhalter.

const DocxFill = (() => {

  function escXml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Alle Text-tragenden XML-Teile eines DOCX (Body + Kopf-/Fußzeilen). Slash-robust,
  // weil manche Tools ZIP-Einträge mit "\" statt "/" speichern (siehe Trainerdaten-Gotcha).
  function _contentEntryNames(zip) {
    return Object.keys(zip.files).filter((name) => {
      const n = name.replace(/\\/g, "/");
      return /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml)$/.test(n);
    });
  }

  // ⚠️ Die Schreibweise im Word ist EGAL: {{Geburtsdatum}}, {{geburtsdatum}} und
  // {{GEBURTSDATUM}} sind derselbe Platzhalter. Der erste Regex kannte nur [A-Z0-9_]
  // — eine Vorlage mit {{Geburtsdatum}} wurde deshalb weder erkannt (also auch nicht
  // bemängelt) noch ersetzt, und der Platzhalter stand roh im fertigen Behörden-
  // schreiben (2026-08-17, Führungszeugnis). Intern wird auf GROSS normalisiert,
  // damit PLATZHALTER_MAP greift; ersetzt wird case-insensitive.
  const _KEY_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

  function _keysAus(text) {
    const set = new Set();
    const re = new RegExp(_KEY_RE.source, "g"); // eigene lastIndex-Instanz
    let m;
    while ((m = re.exec(text)) !== null) set.add(m[1].toUpperCase());
    return set;
  }

  // Führt einen über mehrere <w:t>-Runs zerrissenen Platzhalter wieder zusammen.
  //
  // Word verteilt einen am Stück getippten {{PLATZHALTER}} intern gern auf mehrere
  // Runs (Rechtschreibprüfung, rsid-Marker, eine kurz angefasste Formatierung). Für
  // eine String-Ersetzung ist er damit unsichtbar. Die erste Fassung hat das nur
  // GEMELDET („bitte im Word neu tippen") — in Michels gepflegter Vorlage traf es
  // {{Geburtsdatum}} und {{Datum}}, und Neutippen hätte das Problem beim nächsten
  // Speichern wiederholt.
  //
  // ⚠️ Bewusst minimal-invasiv: es wird AUSSCHLIESSLICH der Text zwischen <w:t> und
  // </w:t> umgeschrieben, und nur dort, wo eine {{…}}-Sequenz tatsächlich über eine
  // Run-Grenze läuft. Kein Element wird angelegt, verschoben oder gelöscht — genau
  // das wäre das Korruptionsrisiko, an dem der frühere Verzicht hing. Der komplette
  // Platzhalter wandert in den ERSTEN beteiligten Run (übernimmt damit dessen
  // Formatierung, was der Absicht entspricht), die übrigen geben ihren Anteil ab.
  function _mergeSplitPlaceholders(xml) {
    const re = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
    const runs = [];
    let m;
    while ((m = re.exec(xml)) !== null) {
      runs.push({ start: m.index, ende: m.index + m[0].length, oeffner: m[1], text: m[2], schliesser: m[3] });
    }
    if (runs.length < 2) return xml;

    // Fortlaufender Text über alle Runs + Rückabbildung auf den einzelnen Run.
    let gesamt = "";
    const grenzen = [];
    runs.forEach((r, i) => {
      grenzen.push({ von: gesamt.length, bis: gesamt.length + r.text.length, i });
      gesamt += r.text;
    });

    // Alle Schnitte sammeln und erst danach anwenden — ein Run kann an mehreren
    // Platzhaltern beteiligt sein, und Sofort-Ersetzen würde die Offsets verschieben.
    const schnitte = runs.map(() => []);
    const pRe = new RegExp("\\{\\{\\s*[A-Za-z0-9_]+\\s*\\}\\}", "g");
    let p, geaendert = false;
    while ((p = pRe.exec(gesamt)) !== null) {
      const von = p.index, bis = von + p[0].length;
      const beteiligt = grenzen.filter((g) => g.von < bis && g.bis > von);
      if (beteiligt.length < 2) continue; // steht schon am Stück — nichts zu tun
      geaendert = true;
      beteiligt.forEach((g, idx) => {
        schnitte[g.i].push({
          von: Math.max(von, g.von) - g.von,
          bis: Math.min(bis, g.bis) - g.von,
          ersatz: idx === 0 ? p[0] : ""
        });
      });
    }
    if (!geaendert) return xml;

    // Von hinten nach vorn, damit die noch offenen Positionen gültig bleiben.
    const neu = runs.map((r, i) => {
      if (!schnitte[i].length) return null;
      let t = r.text;
      schnitte[i].sort((a, b) => b.von - a.von).forEach((s) => {
        t = t.slice(0, s.von) + s.ersatz + t.slice(s.bis);
      });
      // Durch den Schnitt kann ein Leerzeichen an den Rand rutschen. Ohne
      // xml:space="preserve" wirft Word es weg — aus „am 01.02.1990, für" würde
      // „…,für". Der Öffner bekommt das Attribut deshalb bei Bedarf nachgereicht.
      let oeffner = r.oeffner;
      if (/^\s|\s$/.test(t) && !/\bxml:space\s*=/.test(oeffner)) {
        oeffner = oeffner.replace(/\s*\/?>$/, ' xml:space="preserve">');
      }
      return oeffner + t + r.schliesser;
    });

    let out = "", zuletzt = 0;
    runs.forEach((r, i) => {
      if (neu[i] === null) return;
      out += xml.slice(zuletzt, r.start) + neu[i];
      zuletzt = r.ende;
    });
    return out + xml.slice(zuletzt);
  }

  // {{KEY}}, die nach dem Zusammenführen am Stück im XML stehen — nur diese sind
  // per String-Ersetzung befüllbar. Leerzeichen in den Klammern erlaubt.
  function _rawKeys(xml) {
    return _keysAus(_mergeSplitPlaceholders(xml));
  }

  // {{KEY}} nach dem Entfernen aller XML-Tags — findet zusätzlich gesplittete
  // Platzhalter (die _rawKeys nicht sieht).
  function _allKeys(xml) {
    return _keysAus(xml.replace(/<[^>]+>/g, ""));
  }

  // JSZip steht bewusst NICHT fest im <head>: gebraucht wird es nur beim Erzeugen
  // einer Datei, kostet dort aber 28 KB bei JEDEM Seitenaufbau. Erster Bedarf lädt
  // nach, jeder weitere Aufruf bekommt dieselbe Promise (Muster aus
  // raumnutzung/app.js ladeJsZip, fotoauftraege und digitaler-stempel).
  let _jsZipLadevorgang = null;
  function _ladeJsZip() {
    if (typeof JSZip !== "undefined") return Promise.resolve();
    if (_jsZipLadevorgang) return _jsZipLadevorgang;
    _jsZipLadevorgang = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      s.onload = () => resolve();
      s.onerror = () => {
        _jsZipLadevorgang = null; // nächster Versuch darf es erneut probieren
        reject(new Error("ZIP-Bibliothek konnte nicht geladen werden (Internetverbindung nötig)."));
      };
      document.head.appendChild(s);
    });
    return _jsZipLadevorgang;
  }

  async function _loadZip(arrayBuffer) {
    await _ladeJsZip();
    return JSZip.loadAsync(arrayBuffer);
  }

  // Analysiert eine Vorlage (ArrayBuffer). Liefert:
  //   { erkannt:[...], ersetzbar:[...], gesplittet:[...] }
  // erkannt   = alle im Dokument gefundenen Platzhalter (auch gesplittete)
  // ersetzbar = am Stück vorhanden, werden beim Erzeugen wirklich ersetzt
  // gesplittet= erkannt, aber durch Word-Formatierung unterbrochen -> Warnung
  async function analyzeTemplate(arrayBuffer) {
    const zip = await _loadZip(arrayBuffer);
    const names = _contentEntryNames(zip);
    if (names.length === 0) throw new Error("Ungültige Word-Datei: word/document.xml fehlt.");
    const raw = new Set();
    const all = new Set();
    for (const name of names) {
      const xml = await zip.file(name).async("string");
      _rawKeys(xml).forEach((k) => raw.add(k));
      _allKeys(xml).forEach((k) => all.add(k));
    }
    const gesplittet = [...all].filter((k) => !raw.has(k));
    return { erkannt: [...all], ersetzbar: [...raw], gesplittet };
  }

  // Ersetzt {{KEY}} in einem XML-String durch die (XML-escapten) Werte aus `werte`.
  // Replacer als FUNKTION, nicht als String: sonst interpretiert String.replace
  // $-Sequenzen im Wert ($&, $$, $1 …) als Ersetzungsmuster — ein Bankname wie
  // "Bank $& Co" würde still zu "Bank {{BANKNAME}}amp; Co" verstümmelt
  // (Trainerdatens Original nutzt split/join und war nie betroffen).
  function _replaceInXml(xml, werte) {
    let out = xml;
    for (const [key, val] of Object.entries(werte)) {
      // "gi": die Schreibweise im Word darf abweichen (siehe _KEY_RE oben).
      const re = new RegExp("\\{\\{\\s*" + key + "\\s*\\}\\}", "gi");
      out = out.replace(re, () => escXml(val));
    }
    return out;
  }

  // Füllt eine Vorlage (ArrayBuffer) mit einer Werte-Map { KEY: "Wert", ... } und
  // gibt einen .docx-Blob zurück. Nicht in `werte` enthaltene Platzhalter bleiben
  // unverändert stehen (sichtbar => Fehler fällt auf, statt still leer zu sein).
  async function fillToBlob(arrayBuffer, werte) {
    const zip = await _loadZip(arrayBuffer);
    const names = _contentEntryNames(zip);
    if (names.length === 0) throw new Error("Ungültige Word-Datei: word/document.xml fehlt.");
    for (const name of names) {
      const xml = await zip.file(name).async("string");
      // Erst die zerrissenen Platzhalter zusammensetzen, dann ersetzen — sonst
      // liefe die Ersetzung an genau denen vorbei, die Word gesplittet hat.
      zip.file(name, _replaceInXml(_mergeSplitPlaceholders(xml), werte));
    }
    return zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  }

  // Massen-Erzeugung: aus EINER Vorlage je Datensatz eine gefüllte .docx, alle in
  // einem ZIP. `datensaetze` = [{ dateiName, werte }]. Muster generiereAlleVertraegeZip.
  async function buildZip(arrayBuffer, datensaetze, onProgress) {
    await _ladeJsZip();
    // Vorlage einmal laden; pro Datensatz frisch klonen wäre teurer — stattdessen
    // pro Datensatz neu aus dem ArrayBuffer laden (ArrayBuffer bleibt unverändert).
    const zip = new JSZip();
    const usedNames = new Set();
    let done = 0;
    for (const ds of datensaetze) {
      const blob = await fillToBlob(arrayBuffer, ds.werte);
      let name = ds.dateiName;
      let i = 2;
      while (usedNames.has(name)) {
        name = ds.dateiName.replace(/\.docx$/i, "") + "_" + (i++) + ".docx";
      }
      usedNames.add(name);
      zip.file(name, blob);
      done++;
      if (onProgress) onProgress(done, datensaetze.length);
    }
    return zip.generateAsync({ type: "blob" });
  }

  return { analyzeTemplate, fillToBlob, buildZip, escXml };
})();
