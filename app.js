// UI-Logik für Dokumentenvorlagen. Vanilla JS, kein Framework.
// Datenschicht: db.js (Gateway + Admin-WebDAV), Füllung: docx-fill.js.

// ── State ─────────────────────────────────────────────────────────────────────
let catalog = { vorlagen: [] };     // { vorlagen: [{ id, name, beschreibung, fileId, dateiName, ersetzbar[], erkannt[], gesplittet[], erstelltAm }] }
let currentUser = null;
// Bearbeiten-Recht (Tools-Uebersicht editGroupIds; Administrieren schliesst es serverseitig
// ein). Das GANZE Tool ist Bearbeitern vorbehalten: Katalog-Pflege UND Dokumente erstellen
// (Letzteres zieht u.a. IBAN). Seit 2026-07-24 (2. Runde, Michel): Nur-Seher sehen nur den
// Info-Tab -- "Sehen = absolut nichts editierbar".
function canEdit() { return !!(currentUser && (currentUser.isAdmin || currentUser.canEdit)); }
// Administrieren-Ebene: der Einstellungen-Tab ist Administratoren vorbehalten (2026-07-24).
function canAdmin() { return !!(currentUser && (currentUser.isAdmin || currentUser.canAdmin)); }
let profiles = [];                  // Trainerprofile (Gateway), lazy geladen
let webdavConfig = null;            // Admin-WebDAV-Zugang (App-Passwort)
let recipients = [];                // aktuell geladene, normalisierte Empfänger
let selectedIds = new Set();        // ausgewählte Empfänger-Ids
let pendingUpload = null;           // { file, arrayBuffer, analyse } beim Vorlagen-Upload

// ── kleine Helfer ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { const e = $(id); if (e) e.style.display = on ? "" : "none"; };
const val = (id) => { const e = $(id); return e ? e.value : ""; };
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Id für Vorlage und hochgeladene .docx. Der Worker prüft die fileId in
// prepareFileAction() gegen FILE_ID_RE und akzeptiert AUSSCHLIESSLICH das
// UUID-Format — ein Fallback im Stil "b" + ein paar Hex-Zeichen (busplan,
// fahrtenbuch) liefert hier nur ein HTTP 400 statt des TypeErrors, ist also
// kein Ersatz. crypto.randomUUID() gibt es erst ab Safari 15.4; auf älterem
// iOS warf der nackte Aufruf einen TypeError und der Vorlagen-Upload brach ab.
// crypto.getRandomValues gibt es dort seit jeher, daraus bauen wir das Format
// selbst: 16 Zufallsbytes, Version 4 und Variante gesetzt.
function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) +
         "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
function fmtDateOnly(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}
function ibanFmt(iban) {
  if (!iban) return "";
  return String(iban).replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}
function heuteStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function sanitizeFilename(s) {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_").trim() || "Dokument";
}
function normName(s) { return String(s || "").trim().toLowerCase(); }
// Vertauschte Vorname/Nachname tolerieren (Konvention aus der übrigen Flotte).
function sameNamePair(v1, n1, v2, n2) {
  v1 = normName(v1); n1 = normName(n1); v2 = normName(v2); n2 = normName(n2);
  if (!v1 && !n1) return false;
  return (v1 === v2 && n1 === n2) || (v1 === n2 && n1 === v2);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function bannerError(id, msg) {
  const e = $(id);
  if (!e) return;
  if (msg) { e.textContent = msg; e.classList.add("show"); }
  else { e.textContent = ""; e.classList.remove("show"); }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);

async function init() {
  renderVersionBadges();
  renderChangelog();
  renderPlatzhalterReferenz();
  wireStaticEvents();

  if (!getSessionToken()) { show("app-connect-screen", true); return; }

  // Katalog und Trainerdaten-Recht sind voneinander unabhaengig und werden beide
  // sofort angestossen. Der Katalog wird ZUERST abgewartet, weil dav-load das
  // "me" gratis mitliefert (Gateway seit 2026-07-22) — fetchMe() darunter kostet
  // dadurch keinen eigenen Roundtrip mehr. Vorher liefen hier drei Anfragen
  // streng nacheinander (me -> check-edit-permission -> dav-load), also zwei
  // Nextcloud-Roundtrips a 200-450 ms mehr als noetig.
  const katalogPromise = gatewayLoadCatalog();
  const trainerdatenRechtPromise = getSessionToken()
    ? checkTrainerdatenAdminPermission().catch(() => false) // kein Login/Netzfehler: Quelle bleibt aus
    : Promise.resolve(false);

  let katalogFehler = null;
  try {
    const loaded = await katalogPromise;
    if (loaded && Array.isArray(loaded.vorlagen)) catalog = loaded;
  } catch (e) {
    if (e instanceof NotLoggedInError) { show("app-connect-screen", true); return; }
    katalogFehler = e;
  }

  try {
    currentUser = await fetchMe();
  } catch (e) {
    if (e instanceof NotLoggedInError) { show("app-connect-screen", true); return; }
    // fetchMe-Fehler ist nicht fatal — App trotzdem zeigen
  }

  show("app-main", true);
  show("app-connect-screen", false);

  // Nur-Seher: das gesamte Tool ist Bearbeitern vorbehalten -- Katalog-Pflege (Tab "Vorlagen")
  // UND Dokumente erstellen (Tab "Erstellen", zieht u.a. IBAN). Beide Arbeits-Tabs ausblenden,
  // Info aktiv setzen. Serverseitig ist der Katalog ohnehin gesperrt (WRITE_REQUIRES).
  if (!canEdit()) {
    ["erstellen", "vorlagen"].forEach((t) => {
      const btn = document.querySelector('[data-tab="' + t + '"]');
      const sec = document.getElementById("tab-" + t);
      if (btn) { btn.style.display = "none"; btn.classList.remove("active"); }
      if (sec) { sec.classList.remove("active"); sec.style.display = "none"; }
    });
    const infoBtn = document.querySelector('[data-tab="info"]');
    const infoSec = document.getElementById("tab-info");
    if (infoBtn) infoBtn.classList.add("active");
    if (infoSec) { infoSec.classList.add("active"); infoSec.style.display = ""; }
  }

  // Einstellungen-Tab = Administrieren-Ebene (2026-07-24): für Nicht-Admins ausblenden.
  if (!canAdmin()) {
    const eBtn = document.querySelector('[data-tab="einstellungen"]');
    const eSec = document.getElementById("tab-einstellungen");
    if (eBtn) { eBtn.style.display = "none"; eBtn.classList.remove("active"); }
    if (eSec) { eSec.classList.remove("active"); eSec.style.display = "none"; }
  }

  // Trainerdaten-Zugriff hängt seit dem Rechte-Umbau am eigenen Konto
  // (Administrieren-Stufe für Trainerdaten), nicht mehr an einem gespeicherten
  // App-Passwort. Einen früher gespeicherten Zugang (mit Passwort) aus
  // IndexedDB entfernen (Hygiene) und das Recht still prüfen.
  try { await FileStore.clearWebdavConfig(); } catch (_) {}
  // Die Rechteprüfung läuft seit dem Umbau oben parallel zum Katalog — hier wird
  // nur noch ihr Ergebnis abgeholt, nicht mehr auf einen eigenen Roundtrip gewartet.
  if (await trainerdatenRechtPromise) {
    webdavConfig = { url: TRAINERDATEN_WEBDAV_URL, proxyUrl: CORS_PROXY_DEFAULT_URL };
  }
  updateTrainerdatenConnectionUi();

  // Bei vorhandenem Trainerdaten-Zugriff diese Quelle vorwählen, damit Adresse &
  // Bankverbindung sofort geladen werden. Sonst zeigt die Default-Quelle „Trainerprofil"
  // die Adressfelder als fehlend (rot) an, obwohl der Zugriff längst da ist.
  if (webdavConfig) $("quelle-trainerdaten").checked = true;
  updateFilterVisibility();

  if (katalogFehler) console.warn("Katalog konnte nicht geladen werden:", katalogFehler);

  renderTemplateList();
  renderTemplateSelect();
  refreshErstellenTab();
  // ⚠️ Erst HIER, nicht in wireStaticEvents(): die Sichtbarkeit hängt an
  // canEdit(), und `currentUser` steht erst nach fetchMe() fest.
  renderVerteilenSichtbarkeit();

  // Empfänger der Default-Quelle (Profil) direkt laden, damit die Liste nicht leer wirkt.
  if ((catalog.vorlagen || []).length) onQuelleChanged();
}

// ── Statische Events ──────────────────────────────────────────────────────────
function wireStaticEvents() {
  // Tabs
  document.querySelectorAll("nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  initVerteilen();
  // Vorlagen-Upload
  $("btn-tpl-file").addEventListener("click", () => $("tpl-file-input").click());
  $("tpl-file-input").addEventListener("change", (e) => onTemplateFileChosen(e.target.files[0]));
  $("btn-tpl-upload").addEventListener("click", saveTemplate);

  // Erstellen: Vorlage + Quelle
  $("tpl-select").addEventListener("change", onTemplateSelected);
  document.querySelectorAll('input[name="quelle"]').forEach((r) =>
    r.addEventListener("change", onQuelleChanged));

  // Admin-Connect
  $("btn-td-connect").addEventListener("click", trainerdatenConnect);

  // Empfänger
  $("recipient-search").addEventListener("input", () => { renderRecipientList(); updateCount(); });
  ["filter-mannschaft", "filter-lizenz", "filter-vertrag", "filter-fz"].forEach((id) =>
    $(id).addEventListener("change", () => { renderRecipientList(); updateCount(); }));
  $("btn-filter-reset").addEventListener("click", resetFilters);
  // „Alle" wählt bewusst nur die gerade sichtbaren (= gefilterten) Empfänger aus.
  $("btn-recipients-all").addEventListener("click", () => { visibleRecipients().forEach((r) => selectedIds.add(r.id)); renderRecipientList(); updateCount(); });
  $("btn-recipients-none").addEventListener("click", () => { selectedIds.clear(); renderRecipientList(); updateCount(); });

  // Erzeugen
  $("btn-preview-toggle").addEventListener("click", togglePreview);
  $("btn-erzeugen").addEventListener("click", erzeugen);
}

function switchTab(tab) {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.toggle("active", s.id === "tab-" + tab));
}

// ── Platzhalter-Referenz (Vorlagen-Tab) ───────────────────────────────────────
// Statische, klickbare Übersicht aller bekannten Platzhalter — nach Datenquelle
// gruppiert. Klick kopiert {{KEY}} in die Zwischenablage, damit man ihn im Word
// am Stück einfügen kann (verhindert versehentlich gesplittete Runs).
const QUELLE_LABEL = {
  profil: "Aus dem Trainerprofil — immer verfügbar",
  trainerdaten: "Aus den Trainerdaten — nur mit Admin-Datenzugriff (inkl. IBAN)",
  auto: "Automatisch vom Tool gesetzt"
};

function renderPlatzhalterReferenz() {
  const wrap = $("platzhalter-referenz");
  if (!wrap) return;
  wrap.innerHTML = ["profil", "trainerdaten", "auto"].map((q) => {
    const felder = PLATZHALTER_FELDER.filter((f) => f.quelle === q);
    if (!felder.length) return "";
    const chips = felder.map((f) =>
      `<button type="button" class="field-chip ${f.quelle} copyable" data-ph="${esc(f.key)}" title="${esc(f.label)} — klicken zum Kopieren"><span class="chip-key">{{${esc(f.key)}}}</span> <span class="chip-label">${esc(f.label)}</span></button>`
    ).join("");
    return `<div class="ph-group">
      <div class="ph-group-title">${esc(QUELLE_LABEL[q] || q)}</div>
      <div>${chips}</div>
    </div>`;
  }).join("");
  wrap.querySelectorAll("button[data-ph]").forEach((btn) =>
    btn.addEventListener("click", () => copyPlatzhalter(btn)));
}

async function copyPlatzhalter(btn) {
  const text = "{{" + btn.dataset.ph + "}}";
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (_) {
    // Fallback für Kontexte ohne Clipboard-API (z. B. unsicherer Origin).
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (__) { ok = false; }
  }
  if (!ok) return;
  if (btn._copyTimer) { clearTimeout(btn._copyTimer); btn.classList.remove("copied"); }
  const keyEl = btn.querySelector(".chip-key");
  const orig = keyEl ? keyEl.textContent : null;
  btn.classList.add("copied");
  if (keyEl) keyEl.textContent = "✓ kopiert";
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove("copied");
    if (keyEl && orig != null) keyEl.textContent = orig;
    btn._copyTimer = null;
  }, 1100);
}

// ── Vorlagen-Verwaltung ───────────────────────────────────────────────────────
async function onTemplateFileChosen(file) {
  bannerError("tpl-upload-error", "");
  $("tpl-analyze").innerHTML = "";
  $("btn-tpl-upload").disabled = true;
  pendingUpload = null;
  if (!file) return;
  $("tpl-file-name").textContent = file.name;
  if (!/\.docx$/i.test(file.name)) { bannerError("tpl-upload-error", "Bitte eine Word-Datei (.docx) wählen."); return; }
  if (file.size > MAX_TEMPLATE_BYTES) { bannerError("tpl-upload-error", "Datei ist zu groß (max. 8 MB)."); return; }
  let arrayBuffer, analyse;
  try {
    arrayBuffer = await file.arrayBuffer();
    analyse = await DocxFill.analyzeTemplate(arrayBuffer);
  } catch (e) { bannerError("tpl-upload-error", e.message || "Datei konnte nicht gelesen werden."); return; }

  pendingUpload = { file, arrayBuffer, analyse };
  if (!val("tpl-new-name").trim()) $("tpl-new-name").value = file.name.replace(/\.docx$/i, "");
  $("tpl-analyze").innerHTML = renderAnalyse(analyse);
  $("btn-tpl-upload").disabled = false;
}

function renderAnalyse(analyse) {
  let html = "<div class='section-divider'>Erkannte Platzhalter</div>";
  if (!analyse.erkannt.length) {
    html += "<p class='muted'>Keine Platzhalter gefunden. Das Dokument enthält keine <code>{{…}}</code>-Felder — es würde für jeden Empfänger identisch erzeugt.</p>";
  } else {
    html += "<div>" + analyse.erkannt.map((k) => fieldChip(k)).join("") + "</div>";
  }
  if (analyse.gesplittet.length) {
    html += `<p class='warn-banner'>⚠️ Diese Platzhalter sind im Word durch Formatierung unterbrochen und werden <strong>nicht</strong> ersetzt: ${analyse.gesplittet.map((k) => "{{" + esc(k) + "}}").join(", ")}. Bitte im Word einmal am Stück neu eintippen.</p>`;
  }
  return html;
}

function fieldChip(key) {
  const def = PLATZHALTER_MAP[key];
  const cls = def ? def.quelle : "unbekannt";
  const title = def ? def.label : "Unbekannter Platzhalter — wird für jeden Empfänger leer gelassen";
  return `<span class="field-chip ${cls}" title="${esc(title)}">{{${esc(key)}}}</span>`;
}

async function saveTemplate() {
  if (!pendingUpload) return;
  const name = val("tpl-new-name").trim() || pendingUpload.file.name.replace(/\.docx$/i, "");
  bannerError("tpl-upload-error", "");
  $("btn-tpl-upload").disabled = true;
  $("btn-tpl-upload").textContent = "Speichern…";
  try {
    const fileId = uuid();
    const base64 = await blobToBase64(pendingUpload.file);
    await gatewayFilePut(fileId, pendingUpload.file.name, pendingUpload.file.type, base64);
    catalog.vorlagen.push({
      id: uuid(),
      name,
      beschreibung: val("tpl-new-desc").trim(),
      fileId,
      dateiName: pendingUpload.file.name,
      ersetzbar: pendingUpload.analyse.ersetzbar,
      erkannt: pendingUpload.analyse.erkannt,
      gesplittet: pendingUpload.analyse.gesplittet,
      erstelltAm: new Date().toISOString()
    });
    await saveCatalogSafe();
    // Reset
    pendingUpload = null;
    $("tpl-new-name").value = ""; $("tpl-new-desc").value = "";
    $("tpl-file-name").textContent = ""; $("tpl-analyze").innerHTML = "";
    $("tpl-file-input").value = "";
    renderTemplateList();
    renderTemplateSelect();
    refreshErstellenTab();
  } catch (e) {
    bannerError("tpl-upload-error", e.message || "Speichern fehlgeschlagen.");
  } finally {
    $("btn-tpl-upload").textContent = "Vorlage speichern";
    $("btn-tpl-upload").disabled = !pendingUpload;
  }
}

async function saveCatalogSafe() {
  try {
    await gatewaySaveCatalog(catalog);
  } catch (e) {
    if (e instanceof ConflictError) {
      // Remote-Stand neu laden und Fehler weiterreichen (letzte Aktion ggf. wiederholen).
      const fresh = await gatewayLoadCatalog();
      if (fresh && Array.isArray(fresh.vorlagen)) catalog = fresh;
      renderTemplateList(); renderTemplateSelect();
      throw new Error("Der Katalog wurde zwischenzeitlich anderswo geändert und neu geladen — bitte erneut versuchen.");
    }
    throw e;
  }
}

function renderTemplateList() {
  const wrap = $("tpl-list");
  const list = catalog.vorlagen || [];
  show("tpl-list-empty", list.length === 0);
  wrap.innerHTML = list.map((v) => {
    const chips = (v.erkannt || []).map((k) => fieldChip(k)).join("") || "<span class='muted' style='font-size:13px;'>keine Platzhalter</span>";
    const warn = (v.gesplittet && v.gesplittet.length)
      ? `<p class='warn-banner'>⚠️ Nicht ersetzbare Platzhalter: ${v.gesplittet.map((k) => "{{" + esc(k) + "}}").join(", ")}</p>` : "";
    return `<div class="tpl-item">
      <div class="tpl-head">
        <span class="tpl-name">${esc(v.name)}</span>
        <span class="tpl-desc">${esc(v.beschreibung || "")}</span>
      </div>
      <div style="margin-top:8px;">${chips}</div>
      ${warn}
      <div class="tpl-actions">
        <button type="button" class="btn secondary small" data-act="rename" data-id="${esc(v.id)}">Umbenennen</button>
        <button type="button" class="btn secondary small" data-act="desc" data-id="${esc(v.id)}">Beschreibung</button>
        <button type="button" class="btn secondary small" data-act="download" data-id="${esc(v.id)}">Vorlage herunterladen</button>
        <button type="button" class="btn secondary small" data-act="neu-einlesen" data-id="${esc(v.id)}">Platzhalter neu einlesen</button>
        <button type="button" class="btn danger small" data-act="delete" data-id="${esc(v.id)}">Löschen</button>
      </div>
    </div>`;
  }).join("");
  wrap.querySelectorAll("button[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => templateAction(btn.dataset.act, btn.dataset.id)));
}

async function templateAction(act, id) {
  const v = catalog.vorlagen.find((x) => x.id === id);
  if (!v) return;
  if (act === "rename") {
    const name = prompt("Neuer Name der Vorlage:", v.name);
    if (name == null) return;
    v.name = name.trim() || v.name;
    await saveCatalogSafe(); renderTemplateList(); renderTemplateSelect(); refreshErstellenTab();
  } else if (act === "desc") {
    const d = prompt("Beschreibung:", v.beschreibung || "");
    if (d == null) return;
    v.beschreibung = d.trim();
    await saveCatalogSafe(); renderTemplateList();
  } else if (act === "download") {
    try {
      const ab = await gatewayFileGet(v.fileId);
      downloadBlob(new Blob([ab], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), v.dateiName || (sanitizeFilename(v.name) + ".docx"));
    } catch (e) { alert(e.message || "Vorlage nicht abrufbar."); }
  } else if (act === "neu-einlesen") {
    // Die Platzhalter-Liste im Katalog stammt vom Zeitpunkt des Hochladens. Wird die
    // Erkennung nachgeschärft (2026-08-17: Schreibweise egal), stimmt sie für ältere
    // Vorlagen nicht mehr — Vorschau und Warnung zeigten {{Geburtsdatum}} nicht an,
    // obwohl er im Dokument steht. Hier wird die Vorlage einmal neu analysiert; die
    // .docx selbst bleibt unangetastet.
    try {
      const ab = await gatewayFileGet(v.fileId);
      const a = await DocxFill.analyzeTemplate(ab);
      v.ersetzbar = a.ersetzbar; v.erkannt = a.erkannt; v.gesplittet = a.gesplittet;
      await saveCatalogSafe();
      renderTemplateList(); refreshErstellenTab();
    } catch (e) { alert(e.message || "Vorlage nicht abrufbar."); }
  } else if (act === "delete") {
    if (!confirm(`Vorlage „${v.name}" wirklich löschen?`)) return;
    try { await gatewayFileDelete(v.fileId); } catch (_) { /* Datei evtl. schon weg */ }
    catalog.vorlagen = catalog.vorlagen.filter((x) => x.id !== id);
    try { await saveCatalogSafe(); } catch (e) { alert(e.message); return; }
    renderTemplateList(); renderTemplateSelect(); refreshErstellenTab();
  }
}

// ── Erstellen-Tab ─────────────────────────────────────────────────────────────
function renderTemplateSelect() {
  const sel = $("tpl-select");
  const list = catalog.vorlagen || [];
  const prev = sel.value;
  sel.innerHTML = list.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("");
  if (prev && list.some((v) => v.id === prev)) sel.value = prev;
}

function refreshErstellenTab() {
  const has = (catalog.vorlagen || []).length > 0;
  show("erstellen-no-templates", !has);
  show("erstellen-flow", has);
  if (has) onTemplateSelected();
}

function currentVorlage() {
  const id = val("tpl-select");
  return (catalog.vorlagen || []).find((v) => v.id === id) || null;
}
function currentQuelle() {
  const r = document.querySelector('input[name="quelle"]:checked');
  return r ? r.value : "profil";
}

function onTemplateSelected() {
  const v = currentVorlage();
  if (!v) return;
  $("tpl-desc").textContent = v.beschreibung || "";
  const chips = (v.erkannt || []).map((k) => fieldChip(k)).join("") || "<span class='muted' style='font-size:13px;'>keine Platzhalter</span>";
  $("tpl-fields").innerHTML = "<span class='muted' style='font-size:13px; margin-right:6px;'>Felder:</span>" + chips;
  const splitWarn = $("tpl-split-warn");
  if (v.gesplittet && v.gesplittet.length) {
    splitWarn.textContent = `⚠️ Nicht ersetzbare (gesplittete) Platzhalter: ${v.gesplittet.map((k) => "{{" + k + "}}").join(", ")} — im Word am Stück neu eintippen.`;
    splitWarn.style.display = "";
  } else splitWarn.style.display = "none";
  renderRecipientList();
  updateCount();
  refreshPreviewIfOpen();
}

function onQuelleChanged() {
  const quelle = currentQuelle();
  updateFilterVisibility();
  if (quelle === "trainerdaten" && !webdavConfig) {
    show("td-connect", true);
    show("td-connected-hint", false);
  } else {
    show("td-connect", false);
    loadRecipients();
  }
}

// Prüft die Administrieren-Stufe des eigenen Kontos und aktiviert den
// Trainerdaten-Zugriff — ersetzt die frühere App-Passwort-Eingabe (der
// CORS-Proxy erzwingt dieselbe Prüfung serverseitig bei jedem Zugriff).
async function trainerdatenConnect() {
  bannerError("td-connect-error", "");
  $("btn-td-connect").disabled = true; $("btn-td-connect").textContent = "Prüfe…";
  try {
    if (!getSessionToken()) {
      throw new NotLoggedInError("Bitte zuerst in der Tools-Übersicht anmelden (im selben Browser) und diese Seite neu laden.");
    }
    if (!(await checkTrainerdatenAdminPermission())) {
      throw new Error("Dein Konto hat kein Administrieren-Recht für Trainerdaten. Ein Admin kann es im Sichtbarkeits-Panel der Tools-Übersicht vergeben (Häkchen „Administrieren“ bei der passenden Gruppe).");
    }
    const cfg = { url: TRAINERDATEN_WEBDAV_URL, proxyUrl: CORS_PROXY_DEFAULT_URL };
    await fetchTrainerdaten(cfg); // Test-Read
    webdavConfig = cfg;
    show("td-connect", false);
    updateTrainerdatenConnectionUi();
    updateFilterVisibility();
    await loadRecipients();
  } catch (e) {
    bannerError("td-connect-error", e.message || "Zugriffsprüfung fehlgeschlagen.");
  } finally {
    $("btn-td-connect").disabled = false; $("btn-td-connect").textContent = "Zugriff prüfen";
  }
}

function updateTrainerdatenConnectionUi() {
  const connected = !!webdavConfig;
  $("settings-td-status").textContent = connected
    ? "Zugriff vorhanden — dein Konto hat das Administrieren-Recht für Trainerdaten."
    : "Kein Zugriff — nötig ist das Administrieren-Recht für Trainerdaten (Sichtbarkeits-Panel der Tools-Übersicht).";
  const hint = $("td-connected-hint");
  if (connected) { hint.textContent = "✓ Trainerdaten verfügbar — Adresse und Bankverbindung können geladen werden."; show("td-connected-hint", true); }
  else show("td-connected-hint", false);
}

async function loadRecipients() {
  bannerError("recipient-error", "");
  const quelle = currentQuelle();
  recipients = [];
  selectedIds.clear();
  $("recipient-list").innerHTML = "<p class='muted' style='padding:12px;'>Lade…</p>";
  try {
    if (quelle === "profil") {
      if (!profiles.length) profiles = await fetchTrainerProfiles();
      recipients = profiles
        .filter((p) => p.vorname || p.nachname)
        .map((p) => ({
          id: p.username || `${p.vorname} ${p.nachname}`,
          // Das Gateway-Konto, getrennt von `id`: bei dieser Quelle ist beides
          // dasselbe, beim Trainerdaten-Weg unten aber NICHT (dort ist `id` die
          // Trainer-id). Das Bereitstellen braucht den Kontonamen.
          username: p.username || "",
          vorname: p.vorname || "", nachname: p.nachname || "",
          lizenz: p.lizenz || "", mannschaften: p.mannschaften || []
        }));
    } else {
      if (!webdavConfig) { show("td-connect", true); $("recipient-list").innerHTML = ""; renderFilterOptions(); return; }
      const td = await fetchTrainerdaten(webdavConfig);
      if (!profiles.length) { try { profiles = await fetchTrainerProfiles(); } catch (_) {} }
      recipients = td
        .filter((t) => t.vorname || t.nachname)
        .map((t) => {
          const prof = profiles.find((p) => sameNamePair(p.vorname, p.nachname, t.vorname, t.nachname));
          return {
            id: t.id || `${t.vorname} ${t.nachname}`,
            // ⚠️ `id` ist hier die Trainer-id aus trainerdaten.json, NICHT das
            // Gateway-Konto. Für das Bereitstellen im Downloadbereich zählt der
            // Kontoname — er steht am Datensatz (`username`), sonst hilft der
            // Namensabgleich aufs Profil (dieselbe Kette wie bei der Lizenz).
            username: t.username || (prof && prof.username) || "",
            vorname: t.vorname || "", nachname: t.nachname || "",
            geburtsdatum: t.geburtsdatum || "", strasse: t.strasse || "",
            plz: t.plz || "", ort: t.ort || "", telefon: t.telefon || "", email: t.email || "",
            iban: t.iban || "", bankname: t.bankname || "", bic: t.bic || "",
            lizenz: t.lizenz || (prof && prof.lizenz) || "",
            pauschale: t.pauschale != null ? t.pauschale : "",
            mannschaften: (prof && prof.mannschaften) || [],
            // Status-Felder für die Filter — nur in trainerdaten.json vorhanden,
            // nicht im Gateway-Trainerprofil (siehe filterStatusVerfuegbar()).
            fuehrungszeugnisAm: t.fuehrungszeugnisEingereichtAm || "",
            vertragBereitgestelltAm: t.vertragPdfBereitgestelltAm || "",
            vertragUnterschriebenAm: t.vertragUnterschriebenAm || ""
          };
        });
    }
    recipients.sort((a, b) => (a.nachname || "").localeCompare(b.nachname || "", "de") || (a.vorname || "").localeCompare(b.vorname || "", "de"));
  } catch (e) {
    $("recipient-list").innerHTML = "";
    renderFilterOptions();
    bannerError("recipient-error", e.message || "Empfänger konnten nicht geladen werden.");
    return;
  }
  renderFilterOptions();
  renderRecipientList();
  updateCount();
  refreshPreviewIfOpen();
}

// ── Filter ────────────────────────────────────────────────────────────────────
// Die Status-Filter (Vertrag/Führungszeugnis) speisen sich aus trainerdaten.json.
// Das Gateway-Trainerprofil (Quelle „Trainerprofil") liefert nur Name/Lizenz/
// Mannschaft — dort werden sie ausgeblendet UND zurückgesetzt, damit kein
// unsichtbar gesetzter Wert die Liste heimlich leert.
function filterStatusVerfuegbar() {
  return currentQuelle() === "trainerdaten";
}

const OHNE = "__ohne__"; // Sentinel für „ohne Angabe" (kollidiert mit keinem echten Wert)

function updateFilterVisibility() {
  const on = filterStatusVerfuegbar();
  document.querySelectorAll(".filter-status-only").forEach((el) => { el.style.display = on ? "" : "none"; });
  show("filter-status-hint", !on);
  if (!on) { $("filter-vertrag").value = ""; $("filter-fz").value = ""; }
}

// Mannschafts-/Lizenz-Auswahl aus den tatsächlich geladenen Empfängern aufbauen.
// Eine zuvor gewählte Option bleibt erhalten, solange es sie noch gibt.
function renderFilterOptions() {
  const mannschaften = new Set();
  const lizenzen = new Set();
  let ohneMannschaft = false, ohneLizenz = false;
  recipients.forEach((r) => {
    const ms = (r.mannschaften || []).filter((m) => String(m || "").trim());
    if (ms.length) ms.forEach((m) => mannschaften.add(String(m).trim()));
    else ohneMannschaft = true;
    if (String(r.lizenz || "").trim()) lizenzen.add(String(r.lizenz).trim());
    else ohneLizenz = true;
  });
  fillSelect("filter-mannschaft", [...mannschaften].sort((a, b) => a.localeCompare(b, "de")), ohneMannschaft, "ohne Mannschaft");
  fillSelect("filter-lizenz", [...lizenzen].sort((a, b) => a.localeCompare(b, "de")), ohneLizenz, "ohne Lizenz");
}

function fillSelect(id, werte, mitOhne, ohneLabel) {
  const sel = $(id);
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">Alle</option>` +
    werte.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join("") +
    (mitOhne ? `<option value="${OHNE}">(${esc(ohneLabel)})</option>` : "");
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : "";
}

function resetFilters() {
  ["filter-mannschaft", "filter-lizenz", "filter-vertrag", "filter-fz"].forEach((id) => { if ($(id)) $(id).value = ""; });
  $("recipient-search").value = "";
  renderRecipientList();
  updateCount();
}

function matchesFilters(r) {
  const mann = val("filter-mannschaft");
  if (mann) {
    const ms = (r.mannschaften || []).filter((m) => String(m || "").trim());
    if (mann === OHNE ? ms.length > 0 : !ms.some((m) => String(m).trim() === mann)) return false;
  }
  const liz = val("filter-lizenz");
  if (liz) {
    const l = String(r.lizenz || "").trim();
    if (liz === OHNE ? !!l : l !== liz) return false;
  }
  if (filterStatusVerfuegbar()) {
    const vertrag = val("filter-vertrag");
    if (vertrag) {
      const bereit = !!r.vertragBereitgestelltAm, unter = !!r.vertragUnterschriebenAm;
      if (vertrag === "keiner" && (bereit || unter)) return false;
      if (vertrag === "offen" && !(bereit && !unter)) return false;
      if (vertrag === "unterschrieben" && !unter) return false;
    }
    const fz = val("filter-fz");
    if (fz === "fehlt" && r.fuehrungszeugnisAm) return false;
    if (fz === "vorhanden" && !r.fuehrungszeugnisAm) return false;
  }
  return true;
}

function visibleRecipients() {
  const q = normName(val("recipient-search"));
  return recipients.filter((r) =>
    matchesFilters(r) && (!q || (`${r.vorname} ${r.nachname}`).toLowerCase().includes(q)));
}

// Welche der (ersetzbaren) Platzhalter der aktuellen Vorlage kann dieser Empfänger
// nicht füllen? (auto-Felder DATUM/JAHR sind immer vorhanden.)
function missingFieldsFor(emp) {
  const v = currentVorlage();
  if (!v) return [];
  const w = buildWerte(emp);
  return (v.ersetzbar || []).filter((k) => PLATZHALTER_MAP[k] && PLATZHALTER_MAP[k].quelle !== "auto" && !(w[k] && String(w[k]).trim()));
}

function renderRecipientList() {
  const list = visibleRecipients();
  const wrap = $("recipient-list");
  show("recipient-empty", list.length === 0);
  wrap.innerHTML = list.map((r) => {
    const missing = missingFieldsFor(r);
    const meta = [];
    if (r.lizenz) meta.push(esc(r.lizenz));
    if (r.mannschaften && r.mannschaften.length) meta.push(esc(r.mannschaften.join(", ")));
    const metaText = missing.length ? `fehlt: ${missing.map((k) => "{{" + esc(k) + "}}").join(", ")}` : meta.join(" · ");
    return `<label class="recipient-row ${missing.length ? "missing" : ""}">
      <input type="checkbox" data-id="${esc(r.id)}" ${selectedIds.has(r.id) ? "checked" : ""} />
      <span class="r-name">${esc(r.vorname)} ${esc(r.nachname)}</span>
      <span class="r-meta">${metaText}</span>
    </label>`;
  }).join("");
  wrap.querySelectorAll("input[type=checkbox]").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(cb.dataset.id); else selectedIds.delete(cb.dataset.id);
      updateCount(); refreshPreviewIfOpen();
    }));
}

function updateCount() {
  const n = selectedIds.size;
  const sichtbar = visibleRecipients();
  const sichtbarIds = new Set(sichtbar.map((r) => r.id));
  const versteckt = [...selectedIds].filter((id) => !sichtbarIds.has(id)).length;
  let text = n ? `${n} Empfänger ausgewählt.` : "Keine Empfänger ausgewählt.";
  if (sichtbar.length !== recipients.length) text += ` ${sichtbar.length} von ${recipients.length} angezeigt.`;
  // Filter blenden nur die Anzeige aus, sie heben keine Auswahl auf — sonst gingen
  // beim Umschalten still Empfänger verloren. Dafür muss hier sichtbar stehen, dass
  // ausgeblendete Ausgewählte trotzdem ein Dokument bekommen.
  if (versteckt) text += ` ⚠️ ${versteckt} davon ausgeblendet — werden trotzdem erzeugt.`;
  const el = $("recipient-count");
  el.textContent = text;
  el.classList.toggle("warn", versteckt > 0);
}

// ── Werte-Aufbau ──────────────────────────────────────────────────────────────
function buildWerte(emp) {
  const mann = Array.isArray(emp.mannschaften) ? emp.mannschaften.join(", ") : (emp.mannschaften || "");
  const d = new Date();
  return {
    VORNAME: emp.vorname || "", NACHNAME: emp.nachname || "",
    MANNSCHAFT: mann, LIZENZ: emp.lizenz || "",
    GEBURTSDATUM: fmtDateOnly(emp.geburtsdatum),
    STRASSE: emp.strasse || "", PLZ: emp.plz || "", ORT: emp.ort || "",
    PLZ_ORT: `${emp.plz || ""} ${emp.ort || ""}`.trim(),
    TELEFON: emp.telefon || "", EMAIL: emp.email || "",
    IBAN: ibanFmt(emp.iban), BANKNAME: emp.bankname || "", BIC: emp.bic || "",
    PAUSCHALE: emp.pauschale != null ? String(emp.pauschale) : "",
    DATUM: heuteStr(), JAHR: String(d.getFullYear())
  };
}

// ── Vorschau ──────────────────────────────────────────────────────────────────
function togglePreview() {
  const wrap = $("preview-wrap");
  const open = wrap.style.display !== "none" && wrap.innerHTML !== "";
  if (open) { wrap.style.display = "none"; $("btn-preview-toggle").textContent = "Vorschau anzeigen"; }
  else { renderPreview(); wrap.style.display = ""; $("btn-preview-toggle").textContent = "Vorschau ausblenden"; }
}
function refreshPreviewIfOpen() {
  const wrap = $("preview-wrap");
  if (wrap.style.display !== "none" && wrap.innerHTML !== "") renderPreview();
}
function renderPreview() {
  const v = currentVorlage();
  const chosen = recipients.filter((r) => selectedIds.has(r.id));
  const wrap = $("preview-wrap");
  if (!v || !chosen.length) { wrap.innerHTML = "<p class='muted'>Wähle eine Vorlage und mindestens einen Empfänger.</p>"; return; }
  const keys = (v.ersetzbar || []).length ? v.ersetzbar : ["VORNAME", "NACHNAME"];
  let html = "<table class='preview'><thead><tr><th>Empfänger</th>" + keys.map((k) => `<th>{{${esc(k)}}}</th>`).join("") + "</tr></thead><tbody>";
  chosen.slice(0, 50).forEach((emp) => {
    const w = buildWerte(emp);
    html += `<tr><td>${esc(emp.vorname)} ${esc(emp.nachname)}</td>` +
      keys.map((k) => {
        const isAuto = PLATZHALTER_MAP[k] && PLATZHALTER_MAP[k].quelle === "auto";
        const empty = !(w[k] && String(w[k]).trim());
        return `<td class="${empty && !isAuto ? "missing" : ""}">${esc(w[k] || "")}</td>`;
      }).join("") + "</tr>";
  });
  html += "</tbody></table>";
  if (chosen.length > 50) html += `<p class='muted' style='margin-top:8px;'>… und ${chosen.length - 50} weitere.</p>`;
  wrap.innerHTML = html;
}

// ── Erzeugen ──────────────────────────────────────────────────────────────────
async function erzeugen() {
  const v = currentVorlage();
  const chosen = recipients.filter((r) => selectedIds.has(r.id));
  const statusEl = $("erzeugen-status");
  if (!v) { statusEl.textContent = "Keine Vorlage gewählt."; return; }
  if (!chosen.length) { statusEl.textContent = "Keine Empfänger gewählt."; return; }
  $("btn-erzeugen").disabled = true;
  statusEl.textContent = "Lade Vorlage…";
  try {
    const ab = await gatewayFileGet(v.fileId);
    const usedNames = new Set();
    const datensaetze = chosen.map((emp) => {
      let base = `${sanitizeFilename(v.name)}_${sanitizeFilename(emp.nachname)}_${sanitizeFilename(emp.vorname)}`;
      let name = base + ".docx", i = 2;
      while (usedNames.has(name)) name = `${base}_${i++}.docx`;
      usedNames.add(name);
      return { dateiName: name, werte: buildWerte(emp) };
    });
    const zipBlob = await DocxFill.buildZip(ab, datensaetze, (done, total) => {
      statusEl.textContent = `Erzeuge… ${done}/${total}`;
    });
    downloadBlob(zipBlob, `${sanitizeFilename(v.name)}_Dokumente.zip`);
    statusEl.textContent = `✓ ${chosen.length} Dokument(e) erzeugt.`;
  } catch (e) {
    statusEl.textContent = "";
    alert(e.message || "Erzeugen fehlgeschlagen.");
  } finally {
    $("btn-erzeugen").disabled = false;
  }
}

// ── Changelog / Version ───────────────────────────────────────────────────────
function renderVersionBadges() {
  const v = "v" + APP_VERSION;
  const vb2 = $("version-badge-2"); if (vb2) vb2.textContent = v;
}
function renderChangelog() {
  const wrap = $("changelog-list");
  if (!wrap) return;
  wrap.innerHTML = (APP_CHANGELOG || []).map((entry) => `
    <div class="changelog-version">
      <h4>Version ${esc(entry.version)}</h4>
      ${(entry.groups || []).map((g) => `
        <div class="changelog-group">
          <div class="cg-title">${esc(g.title)}</div>
          <ul>${(g.items || []).map((it) => `<li>${esc(it)}</li>`).join("")}</ul>
        </div>`).join("")}
    </div>`).join("");
}

// ── Im Downloadbereich bereitstellen (seit 2026-08-17) ────────────────────────
//
// Der Schritt nach dem Erzeugen: die fertigen PDFs landen bei den Personen im
// Tab „Mein Konto" der Tools-Übersicht.
//
// ⚠️ Warum PDFs von der Platte statt direkt aus Schritt 3: dieses Tool erzeugt
// Word-Dateien, und im Browser gibt es keine verlässliche Umwandlung nach PDF.
// Der Weg führt über `docx-zu-pdf.ps1` (Word-COM) auf dem Rechner — dafür sieht
// das Ergebnis aus wie die Vorlage, mit Briefkopf und Logo. Michel-Entscheidung
// vom 2026-08-17 gegen einen nachgebauten Brief.
//
// ⚠️ Zugeordnet wird über den DATEINAMEN, nicht über einen gemerkten Zustand.
// Zwischen Erzeugen und Bereitstellen liegt ein Schritt außerhalb des Browsers;
// wer die Seite dazwischen neu lädt, hätte sonst nichts mehr in der Hand. Der
// Name kommt aus `erzeugen()` und lautet `<Vorlage>_<Nachname>_<Vorname>.docx`.

let verteilenAuswahl = [];  // [{ datei, empfaenger|null, name }]

function verteilenVerfuegbar() {
  return canEdit();
}

function initVerteilen() {
  const w = $("btn-verteilen-waehlen");
  if (!w) return;
  w.addEventListener("click", () => $("verteilen-input").click());
  $("verteilen-input").addEventListener("change", (e) => {
    const files = [...e.target.files]; e.target.value = "";
    if (files.length) verteilenDateienGewaehlt(files);
  });
  $("btn-verteilen").addEventListener("click", verteilenAusfuehren);

  $("btn-allgemein-waehlen").addEventListener("click", () => $("allgemein-input").click());
  $("allgemein-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) allgemeinBereitstellen(f);
  });
}

// Zeigt die drei Karten nur, wer bereitstellen darf. Der Rest des Tabs steht
// jedem offen, der Dokumente erzeugen darf — das ist eine andere Frage.
function renderVerteilenSichtbarkeit() {
  const an = verteilenVerfuegbar();
  ["verteilen-card", "allgemein-card", "bereitgestellt-card"].forEach((id) => {
    const el = $(id); if (el) el.style.display = an ? "" : "none";
  });
  if (an) bereitgestelltLaden();
}

// „Erweitertes_Fuehrungszeugnis_Mueller_Anna.pdf" -> Empfänger Anna Müller.
//
// ⚠️ Verglichen wird über `sanitizeFilename`, also mit derselben Funktion, die
// den Namen erzeugt hat. Ein eigener Vergleich (Umlaute, Bindestriche, Groß-
// schreibung) liefe unweigerlich auseinander.
//
// Das Suffix `_<Nachname>_<Vorname>[_N]`, das erzeugen() an den Vorlagennamen hängt.
// EINE Quelle für Zuordnung UND Anzeigename — zwei eigene Regexe liefen auseinander.
// Das angehängte „_2" aus der Doppelnamen-Behandlung darf nicht stören.
function verteilenNamensSuffixRe(r) {
  const muster = `_${sanitizeFilename(r.nachname)}_${sanitizeFilename(r.vorname)}`;
  return new RegExp(muster.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(_\\d+)?$", "i");
}

function verteilenEmpfaengerZuDatei(dateiName) {
  const basis = dateiName.replace(/\.pdf$/i, "");
  const treffer = recipients.filter((r) => basis !== "" && verteilenNamensSuffixRe(r).test(basis));
  // Zwei Treffer heißen zwei namensgleiche Personen — dann wird nicht geraten.
  return treffer.length === 1 ? treffer[0] : null;
}

function verteilenDateienGewaehlt(files) {
  const fehler = $("verteilen-fehler");
  fehler.style.display = "none";
  if (!recipients.length) {
    fehler.textContent = "Lade zuerst oben die Empfänger — ohne sie lässt sich keine Datei zuordnen.";
    fehler.style.display = "block";
    return;
  }
  const zuViel = files.length > 60;
  verteilenAuswahl = files.slice(0, 60).map((datei) => {
    const emp = verteilenEmpfaengerZuDatei(datei.name);
    return { datei, empfaenger: emp, name: datei.name };
  });
  if (zuViel) {
    fehler.textContent = "Es werden höchstens 60 Dateien auf einmal verarbeitet — die übrigen bitte in einem zweiten Durchgang.";
    fehler.style.display = "block";
  }
  renderVerteilenZuordnung();
}

function renderVerteilenZuordnung() {
  const wrap = $("verteilen-zuordnung");
  const aktion = $("verteilen-aktion");
  if (!verteilenAuswahl.length) {
    wrap.style.display = "none"; wrap.innerHTML = "";
    aktion.style.display = "none";
    return;
  }
  const passend = verteilenAuswahl.filter((z) => z.empfaenger && z.empfaenger.username);
  const ohneKonto = verteilenAuswahl.filter((z) => z.empfaenger && !z.empfaenger.username);
  const offen = verteilenAuswahl.filter((z) => !z.empfaenger);

  const zeile = (z, text, klasse) => `
    <div class="dv-zuordnung ${klasse}">
      <span class="dv-zuordnung-datei">${esc(z.name)}</span>
      <span class="muted">${esc(text)}</span>
    </div>`;

  wrap.innerHTML =
    passend.map((z) => zeile(z, "→ " + z.empfaenger.vorname + " " + z.empfaenger.nachname
      + " · erscheint als „" + verteilenAnzeigename(z) + "“", "ok")).join("") +
    ohneKonto.map((z) => zeile(z, "→ " + z.empfaenger.vorname + " " + z.empfaenger.nachname + " — kein Konto in der Tools-Übersicht, kann nicht bereitgestellt werden", "warn")).join("") +
    offen.map((z) => zeile(z, "keiner Person zuzuordnen — wird übersprungen", "warn")).join("");
  wrap.style.display = "";

  const btn = $("btn-verteilen");
  btn.disabled = !passend.length;
  btn.textContent = passend.length
    ? `Bereitstellen (${passend.length})`
    : "Bereitstellen";
  aktion.style.display = "";
  $("verteilen-status").textContent = "";
}

async function dateiAlsBase64(datei) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const komma = s.indexOf(",");
      resolve(komma >= 0 ? s.slice(komma + 1) : s);
    };
    r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(datei);
  });
}

// ⚠️ Eine Datei je Aufruf, nacheinander. Ein Sammel-Request mit 60 PDFs à 10 MB
// wäre ein Rundlauf, an dem ein Worker stirbt — und ein Fehlschlag mittendrin
// ließe sich nicht mehr zuordnen. So sagt der Bericht am Ende genau, was durch
// ist und was nicht.
async function verteilenAusfuehren() {
  const btn = $("btn-verteilen");
  const status = $("verteilen-status");
  const fehler = $("verteilen-fehler");
  fehler.style.display = "none";
  const push = $("verteilen-push").checked;
  const zu = verteilenAuswahl.filter((z) => z.empfaenger && z.empfaenger.username);
  if (!zu.length) return;

  btn.disabled = true;
  const gescheitert = [];
  let fertig = 0;
  for (const z of zu) {
    status.textContent = `Stelle bereit… ${fertig}/${zu.length}`;
    try {
      const dataBase64 = await dateiAlsBase64(z.datei);
      await gatewayRequest({
        action: "unterlage-verteilen",
        fuer: z.empfaenger.username,
        name: verteilenAnzeigename(z),
        dateiName: z.name,
        push,
        dataBase64
      });
      fertig++;
    } catch (e) {
      gescheitert.push(z.name + ": " + (e.message || "Fehler"));
    }
  }
  btn.disabled = false;
  status.textContent = `✓ ${fertig} von ${zu.length} bereitgestellt.`;
  if (gescheitert.length) {
    fehler.textContent = "Nicht bereitgestellt: " + gescheitert.join(" · ");
    fehler.style.display = "block";
  }
  verteilenAuswahl = [];
  renderVerteilenZuordnung();
  bereitgestelltLaden();
}

// Der Name, den die Person sieht. Der Dateiname trägt Vorlage UND Personennamen —
// letzterer ist für den Empfänger überflüssig, also nur die Vorlage.
//
// ⚠️ Der Titel kommt aus dem DATEINAMEN, nicht aus der oben gewählten Vorlage.
// Zwischen Erzeugen und Bereitstellen liegt der Word-Lauf außerhalb des Browsers;
// hochgeladen wird ein früherer Stapel, während in Schritt 1 längst eine andere
// Vorlage stehen kann. Genau so stand am 2026-08-17 „Übungsleitervertrag" über
// einem Führungszeugnis. Die Unterstriche stammen aus `sanitizeFilename` und
// werden wieder zu Leerzeichen.
function verteilenAnzeigename(z) {
  const basis = z.name.replace(/\.pdf$/i, "");
  const ohnePerson = z.empfaenger ? basis.replace(verteilenNamensSuffixRe(z.empfaenger), "") : basis;
  return (ohnePerson || basis).replace(/_/g, " ").trim() || basis;
}

async function allgemeinBereitstellen(datei) {
  const status = $("allgemein-status");
  const fehler = $("allgemein-fehler");
  fehler.style.display = "none";
  status.textContent = "Lädt hoch…";
  try {
    const dataBase64 = await dateiAlsBase64(datei);
    await gatewayRequest({
      action: "unterlage-verteilen",
      fuer: "",
      name: $("allgemein-name").value.trim() || datei.name.replace(/\.pdf$/i, ""),
      dateiName: datei.name,
      dataBase64
    });
    status.textContent = "✓ Bereitgestellt.";
    $("allgemein-name").value = "";
    setTimeout(() => { status.textContent = ""; }, 2500);
    bereitgestelltLaden();
  } catch (e) {
    status.textContent = "";
    fehler.textContent = e.message || "Bereitstellen fehlgeschlagen.";
    fehler.style.display = "block";
  }
}

async function bereitgestelltLaden() {
  const liste = $("bereitgestellt-liste");
  const leer = $("bereitgestellt-empty");
  const fehler = $("bereitgestellt-fehler");
  if (!liste) return;
  fehler.style.display = "none";
  let data;
  try {
    data = await gatewayRequest({ action: "unterlagen-alle" });
  } catch (e) {
    // Ein noch nicht deployter Worker soll keine rote Zeile erzeugen.
    $("bereitgestellt-card").style.display = "none";
    return;
  }
  const eintraege = Array.isArray(data.eintraege) ? data.eintraege : [];
  leer.style.display = eintraege.length ? "none" : "";
  liste.innerHTML = eintraege.map((e) => `
    <div class="dv-bereit-zeile">
      <div class="dv-bereit-text">
        <strong>${esc(e.name)}</strong>
        <span class="muted" style="font-size:12px;">${esc(e.persoenlich ? "für " + e.fuer : "für alle")} · ${esc(e.dateiName)} · seit ${esc(fmtDateOnly(e.hochgeladenAm))}</span>
      </div>
      <button type="button" class="btn danger small" data-bereit-del="${esc(e.id)}">Entfernen</button>
    </div>`).join("");
  liste.querySelectorAll("button[data-bereit-del]").forEach((b) => {
    b.addEventListener("click", () => bereitgestelltEntfernen(b.dataset.bereitDel, b));
  });
}

async function bereitgestelltEntfernen(id, btn) {
  if (!confirm("Diese Unterlage aus dem Downloadbereich entfernen?")) return;
  const fehler = $("bereitgestellt-fehler");
  fehler.style.display = "none";
  btn.disabled = true;
  try {
    await gatewayRequest({ action: "unterlage-entfernen", id });
    bereitgestelltLaden();
  } catch (e) {
    btn.disabled = false;
    fehler.textContent = e.message || "Entfernen fehlgeschlagen.";
    fehler.style.display = "block";
  }
}
