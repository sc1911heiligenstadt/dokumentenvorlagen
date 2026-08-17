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

  // {{KEY}}, die DIREKT (am Stück) im XML stehen — nur diese sind per String-
  // Ersetzung befüllbar. Optionale Leerzeichen innerhalb der Klammern erlaubt.
  function _rawKeys(xml) {
    return _keysAus(xml);
  }

  // {{KEY}} nach dem Entfernen aller XML-Tags — findet zusätzlich gesplittete
  // Platzhalter (die _rawKeys nicht sieht).
  function _allKeys(xml) {
    return _keysAus(xml.replace(/<[^>]+>/g, ""));
  }

  async function _loadZip(arrayBuffer) {
    if (typeof JSZip === "undefined") throw new Error("JSZip nicht geladen — bitte Seite neu laden.");
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
      zip.file(name, _replaceInXml(xml, werte));
    }
    return zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  }

  // Massen-Erzeugung: aus EINER Vorlage je Datensatz eine gefüllte .docx, alle in
  // einem ZIP. `datensaetze` = [{ dateiName, werte }]. Muster generiereAlleVertraegeZip.
  async function buildZip(arrayBuffer, datensaetze, onProgress) {
    if (typeof JSZip === "undefined") throw new Error("JSZip nicht geladen.");
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
