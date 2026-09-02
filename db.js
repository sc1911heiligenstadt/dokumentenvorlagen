// Datenschicht: zentraler Login-Gateway (Katalog-Metadaten + .docx-Binaries +
// Trainerprofil) UND Admin-WebDAV-Lesezugriff auf trainerdaten.json (inkl. IBAN,
// nur nach App-Passwort-Eingabe). IndexedDB hält nur die Admin-WebDAV-Zugangsdaten
// zwischen den Sitzungen. Muster übernommen aus E:\TrainerCheckliste\db.js und
// E:\Trainerdaten\db.js.

const FileStore = (() => {
  const DB_NAME = "dokumentenvorlagen-db";
  const STORE = "handles";
  const KEY_WEBDAV_CONFIG = "webdavConfig";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getValue(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function setValue(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearValue(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    getWebdavConfig: () => getValue(KEY_WEBDAV_CONFIG),
    setWebdavConfig: (cfg) => setValue(KEY_WEBDAV_CONFIG, cfg),
    clearWebdavConfig: () => clearValue(KEY_WEBDAV_CONFIG)
  };
})();

// ─── Gateway (Login-Token) ────────────────────────────────────────────────────
const TOKEN_STORAGE_KEY = "tu_session_token";

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || "Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}
class ConflictError extends Error {
  constructor(message) {
    super(message || "Der Katalog wurde zwischenzeitlich von einem anderen Gerät geändert.");
    this.name = "ConflictError";
  }
}

// ETag des zuletzt geladenen/geschriebenen Katalog-Stands (Konflikterkennung).
let gatewayRev = null;

function getSessionToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

async function gatewayRequest(payload) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (resp.status === 403) throw new Error("Kein Zugriff auf dieses Tool.");
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok) throw new Error(`Gateway-Fehler (HTTP ${resp.status})`);
  return resp.json();
}

// Das "me" aus der letzten dav-load-Antwort. Der Worker legt es bei, weil er
// nutzer.json und die Rechte-Datei fuer diesen Request ohnehin gelesen hat --
// der erste fetchMe() nach dem Laden kommt damit ohne eigenen Roundtrip aus.
let gatewayMe = null;

// Liefert {username, isAdmin, groupIds, vorname, nachname, canEdit, canAdmin} der eingeloggten Person.
async function fetchMe() {
  // Genau EINMAL aus dem letzten dav-load bedienen, danach wieder echt fragen:
  // ein spaeterer Aufruf will den aktuellen Stand (etwa nach einem Rechte-
  // wechsel), nicht eine beliebig alte Kopie. Faellt von selbst auf den Request
  // zurueck, wenn der Worker das Feld noch nicht mitschickt.
  if (gatewayMe) { const me = gatewayMe; gatewayMe = null; return me; }
  return gatewayRequest({ action: "me", app: GATEWAY_APP_ID });
}

// Katalog-Metadaten (Vorlagen-Liste) laden/speichern — JSON über dav-load/dav-save.
async function gatewayLoadCatalog() {
  const body = await gatewayRequest({ action: "dav-load", app: GATEWAY_APP_ID });
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
  gatewayMe = (body.me && typeof body.me === "object") ? body.me : null;
  return body.data; // Objekt oder null (Datei noch nicht vorhanden)
}
async function gatewaySaveCatalog(dataObj) {
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = await gatewayRequest(payload);
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
}

// Zentrales Trainerprofil ALLER Nutzer (Name/Lizenz/Mannschaften) — für die
// Empfängerauswahl ohne Admin-Datenzugriff.
async function fetchTrainerProfiles() {
  const body = await gatewayRequest({ action: "list-trainer-profiles" });
  return Array.isArray(body.profiles) ? body.profiles : [];
}

// ─── Binärdateien (.docx-Vorlagen) über den Gateway-Dateikanal ────────────────
// Die Vorlagen liegen im offenen dateien/<uuid>-Ordner der App (nicht sensibel:
// leere Templates ohne Personendaten). id wird clientseitig als UUID vergeben.
async function gatewayFilePut(id, name, contentType, dataBase64) {
  return gatewayRequest({
    action: "dav-file-put", app: GATEWAY_APP_ID, id, name,
    contentType: contentType || "application/octet-stream", dataBase64
  });
}
async function gatewayFileDelete(id) {
  return gatewayRequest({ action: "dav-file-delete", app: GATEWAY_APP_ID, id });
}
// Rohe Datei-Bytes (ArrayBuffer) holen — eigener Fetch, da kein JSON zurückkommt.
async function gatewayFileGet(id) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "dav-file-get", app: GATEWAY_APP_ID, id })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (resp.status === 404) throw new Error("Vorlagendatei nicht gefunden (evtl. gelöscht).");
  if (!resp.ok) throw new Error(`Vorlage nicht abrufbar (HTTP ${resp.status})`);
  return resp.arrayBuffer();
}

// base64 aus einem Blob/File (ohne data:-Präfix) — für dav-file-put.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(blob);
  });
}

// ─── Admin-WebDAV: trainerdaten.json read-only (inkl. IBAN) ────────────────────
// Seit dem Trainerdaten-Rechte-Umbau (2026-07-23) verlangt der Trainerdaten-
// CORS-Proxy den ToolsUebersicht-Login-Token (Bearer) und prüft serverseitig
// die Administrieren-Stufe für Trainerdaten (canAdmin aus der Gateway-Aktion
// check-edit-permission — seit der dritten Rechte-Stufe 2026-07-24 reicht das
// Bearbeiten-Häkchen nicht mehr, hier hängt die IBAN dran); die Nextcloud-
// Zugangsdaten hält er selbst als Worker-Secrets. Das früher hier eingegebene
// App-Passwort ist abgeschafft.
function davAuthHeader() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  return "Bearer " + token;
}
function davRequestUrl(config) {
  if (config.proxyUrl) {
    return config.proxyUrl.replace(/\/$/, "") + "/?url=" + encodeURIComponent(config.url);
  }
  return config.url;
}
async function davReadFile(config) {
  const resp = await fetch(davRequestUrl(config), {
    method: "GET",
    headers: { Authorization: davAuthHeader() }
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen — bitte in der Tools-Übersicht neu anmelden.");
  if (resp.status === 403) throw new Error("Kein Administrieren-Recht für Trainerdaten (Häkchen „Administrieren“ in der Tools-Übersicht nötig).");
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`WebDAV-Lesefehler (HTTP ${resp.status})`);
  const text = await resp.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

// Eigene Administrieren-Stufe für Trainerdaten — dieselbe Prüfung, die der
// CORS-Proxy serverseitig für jeden Zugriff macht (klare Meldung vorab).
async function checkTrainerdatenAdminPermission() {
  const body = await gatewayRequest({ action: "check-edit-permission", app: "trainerdaten" });
  return body.canAdmin === true;
}

// Liest die Trainerdaten (Array) über den bestehenden Trainerdaten-CORS-Proxy.
// Gibt die rohen Trainer-Objekte zurück (vorname/nachname/iban/... — genau die
// Felder, die trainerdaten.json enthält).
async function fetchTrainerdaten(config) {
  const data = await davReadFile(config);
  const arr = data && Array.isArray(data.trainer) ? data.trainer : [];
  return arr;
}
