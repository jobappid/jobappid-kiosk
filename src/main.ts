// src/main.ts
import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import Store from "electron-store";
import keytar from "keytar";

const SERVICE = "JobAppID-Kiosk";
const ACCOUNT = "kiosk_api_key";

// =========================
// ✅ API BASE (no hardcoding)
// Priority:
// 1) process.env.JOBAPPID_API_BASE  (installer / production)
// 2) electron-store value "api_base" (optional admin setting)
// 3) fallback default (production)
// =========================
const DEFAULT_API_BASE = "https://api.jobappid.com";

function normalizeBaseUrl(v: string): string {
  return String(v || "")
    .trim()
    .replace(/\/+$/, ""); // remove trailing slash(es)
}

const store = new Store<{
  business_id?: string;
  business_name?: string;
  kiosk_id?: string;

  // printer settings
  printer_name?: string;

  // ✅ API base override (optional)
  api_base?: string;
}>();

function getApiBase(): string {
  const envBase = normalizeBaseUrl(String(process.env.JOBAPPID_API_BASE || ""));
  if (envBase) return envBase;

  const stored = normalizeBaseUrl(String(store.get("api_base") ?? ""));
  if (stored) return stored;

  return normalizeBaseUrl(DEFAULT_API_BASE);
}

// =========================
// Admin-only exit settings
// =========================
const ADMIN_EXIT_PIN = "1492";

async function getKioskKey(): Promise<string | null> {
  const key = await keytar.getPassword(SERVICE, ACCOUNT);
  return key ?? null;
}

type KioskState = {
  paired: boolean;
  business?: { id: string; name: string };
  kiosk?: { id: string };
};

type ReceiptPayload = {
  application_id?: string;
  submitted_at?: string;
  business_id?: string;
  kiosk_id?: string;

  business_name?: string;
  applicant_name?: string;
  badge_masked?: string;
  position_title?: string;
};

let mainWindow: BrowserWindow | null = null;

// Gatekeeper for allowing the kiosk window to close only when allowClose is true
let allowClose = false;

function getState(): KioskState {
  const business_id = store.get("business_id");
  const business_name = store.get("business_name");
  const kiosk_id = store.get("kiosk_id");

  if (business_id && business_name && kiosk_id) {
    return {
      paired: true,
      business: { id: business_id, name: business_name },
      kiosk: { id: kiosk_id }
    };
  }

  return { paired: false };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,

    // kiosk mode
    kiosk: true,
    fullscreen: true,
    autoHideMenuBar: true,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  mainWindow.setMenu(null);

  // dist/main.js -> ../public/kiosk.html
  mainWindow.loadFile(path.join(__dirname, "../public/kiosk.html"));
}

// =========================
// ✅ Auto-update (Option A)
// =========================
function initAutoUpdate() {
  // Only run updater in packaged builds (NOT during npm run dev)
  if (!app.isPackaged) {
    console.log("[update] dev mode - updater disabled");
    return;
  }

  // Auto behavior
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => console.log("[update] checking..."));
  autoUpdater.on("update-available", (info) => console.log("[update] available", info?.version));
  autoUpdater.on("update-not-available", () => console.log("[update] none"));
  autoUpdater.on("error", (err) => console.log("[update] error", err));
  autoUpdater.on("download-progress", (p) => {
    console.log(`[update] downloading ${Math.round(p.percent)}%`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log("[update] downloaded", info?.version, "- will install on quit");
    // If you ever want immediate install, we can switch to:
    // autoUpdater.quitAndInstall();
  });

  // Check shortly after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => console.log("[update] check failed", e));
  }, 3000);
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdate();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Prevent closing the kiosk window unless allowClose is true
app.on("browser-window-created", (_evt, win) => {
  win.on("close", (e) => {
    if (!allowClose) e.preventDefault();
  });
});

// =========================
// Printing helpers
// =========================
function getSavedPrinterName(): string {
  return String(store.get("printer_name") ?? "").trim();
}

function setSavedPrinterName(name: string) {
  const n = String(name ?? "").trim();
  if (!n) {
    store.delete("printer_name");
    return;
  }
  store.set("printer_name", n);
}

async function listPrinters(): Promise<Array<{ name: string; isDefault: boolean }>> {
  if (!mainWindow) return [];
  const printers = await mainWindow.webContents.getPrintersAsync();
  return (printers || []).map((p: any) => ({
    name: String(p.name ?? ""),
    isDefault: !!p.isDefault
  }));
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReceiptHtml(payload: ReceiptPayload): string {
  const biz = payload.business_name || String(store.get("business_name") ?? "");
  const appId = payload.application_id || "";
  const ts = payload.submitted_at || new Date().toISOString();
  const kioskId = payload.kiosk_id || String(store.get("kiosk_id") ?? "");
  const applicant = payload.applicant_name || "";
  const badge = payload.badge_masked || "";
  const pos = payload.position_title || "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>JobAppID Receipt</title>
  <style>
    html, body { margin:0; padding:0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color:#000; }
    .wrap { padding: 10px; width: 58mm; }
    h1 { font-size: 14px; margin: 0 0 6px 0; text-align:center; }
    .line { border-top: 1px dashed #000; margin: 8px 0; }
    .row { display:flex; justify-content:space-between; gap:10px; }
    .k { font-weight:700; }
    .v { text-align:right; word-break: break-word; }
    .small { font-size: 11px; }
    .center { text-align:center; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>JobAppID Receipt</h1>
    ${biz ? `<div class="center small">${escapeHtml(biz)}</div>` : ""}

    <div class="line"></div>

    ${applicant ? `<div class="row"><div class="k">Applicant</div><div class="v">${escapeHtml(applicant)}</div></div>` : ""}
    ${badge ? `<div class="row"><div class="k">Badge</div><div class="v">${escapeHtml(badge)}</div></div>` : ""}
    ${pos ? `<div class="row"><div class="k">Position</div><div class="v">${escapeHtml(pos)}</div></div>` : ""}

    <div class="row"><div class="k">App ID</div><div class="v">${escapeHtml(appId)}</div></div>
    <div class="row"><div class="k">Time</div><div class="v">${escapeHtml(ts)}</div></div>
    <div class="row"><div class="k">Kiosk</div><div class="v">${escapeHtml(kioskId)}</div></div>

    <div class="line"></div>
    <div class="center small">Thank you</div>
  </div>
</body>
</html>`;
}

function printToDevice(win: BrowserWindow, options: any): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      win.webContents.print(options, (success) => resolve(!!success));
    } catch (e) {
      reject(e);
    }
  });
}

async function printHtmlSilently(
  html: string
): Promise<{ ok: true } | { ok: false; error: { message: string } }> {
  const deviceName = getSavedPrinterName();
  if (!deviceName) {
    return {
      ok: false,
      error: { message: "Printer not set. Choose a printer in Admin > Printer Setup first." }
    };
  }

  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);

    await new Promise((r) => setTimeout(r, 150));

    const result = await printToDevice(win, {
      silent: true,
      printBackground: true,
      deviceName,
      margins: { marginType: "none" },
      pageSize: { width: 58000, height: 200000 }
    } as any);

    if (!result) {
      return {
        ok: false,
        error: { message: "Print failed. Check printer availability/spooler and saved device name." }
      };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: { message: e?.message ?? "Print error" } };
  } finally {
    try {
      win.destroy();
    } catch {}
  }
}

// =========================
// ✅ IPC: API base (optional but important for installer)
// =========================
ipcMain.handle("apiBase:get", async () => {
  return { ok: true, api_base: getApiBase() };
});

ipcMain.handle("apiBase:set", async (_evt, { api_base }: { api_base: string }) => {
  const v = normalizeBaseUrl(api_base);
  if (!v) {
    store.delete("api_base");
    return { ok: true, api_base: getApiBase() };
  }
  store.set("api_base", v);
  return { ok: true, api_base: getApiBase() };
});

// =========================
// IPC: renderer -> main
// =========================
ipcMain.handle("getStatus", async () => getState());

ipcMain.handle("reset", async () => {
  store.delete("business_id");
  store.delete("business_name");
  store.delete("kiosk_id");
  await keytar.deletePassword(SERVICE, ACCOUNT);
  return { ok: true };
});

ipcMain.handle("pair", async (_evt, { code }: { code: string }) => {
  const API_BASE = getApiBase();

  const resp = await fetch(`${API_BASE}/kiosk/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, kiosk_name: "Laptop Kiosk" })
  });

  const json = await resp.json().catch(() => null);

  if (!resp.ok || !json?.ok) {
    return {
      ok: false,
      error: json?.error ?? { message: `Pairing failed (${resp.status})` }
    };
  }

  store.set("business_id", json.business.id);
  store.set("business_name", json.business.name);
  store.set("kiosk_id", json.kiosk.id);

  await keytar.setPassword(SERVICE, ACCOUNT, json.kiosk_api_key);

  return { ok: true, state: getState() };
});

ipcMain.handle("kioskMe", async () => {
  const API_BASE = getApiBase();

  const kioskKey = await getKioskKey();
  if (!kioskKey) {
    return { ok: false, error: { message: "Kiosk key missing. Reset and re-pair." } };
  }

  const resp = await fetch(`${API_BASE}/kiosk/app/me`, {
    method: "GET",
    headers: { "X-KIOSK-KEY": kioskKey }
  });

  const json = await resp.json().catch(() => null);

  if (!resp.ok || !json?.ok) {
    return {
      ok: false,
      error: json?.error ?? { message: `Failed to load kiosk profile (${resp.status})` }
    };
  }

  return { ok: true, data: json };
});

ipcMain.handle(
  "apply",
  async (_evt, payload: { badge_token: string; patron_code: string; position_id?: string | null }) => {
    const API_BASE = getApiBase();

    const kioskKey = await getKioskKey();
    if (!kioskKey) {
      return { ok: false, error: { message: "Kiosk key missing. Reset and re-pair." } };
    }

    const resp = await fetch(`${API_BASE}/kiosk/app/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KIOSK-KEY": kioskKey
      },
      body: JSON.stringify(payload)
    });

    const json = await resp.json().catch(() => null);

    if (!resp.ok || !json?.ok) {
      return {
        ok: false,
        error: json?.error ?? { message: `Submit failed (${resp.status})` }
      };
    }

    return {
      ok: true,
      receipt: json.receipt,
      receipt_url: json.receipt_url || null
    };
  }
);

ipcMain.handle("badgeLookup", async (_evt, payload: { badge_token: string }) => {
  const API_BASE = getApiBase();

  const token = String(payload?.badge_token ?? "").trim();
  if (!token) return { ok: false, error: { message: "badge_token required" } };

  const kioskKey = await getKioskKey();
  if (!kioskKey) return { ok: false, error: { message: "Kiosk key missing. Reset and re-pair." } };

  const resp = await fetch(`${API_BASE}/kiosk/app/badge-lookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-KIOSK-KEY": kioskKey
    },
    body: JSON.stringify({ badge_token: token })
  });

  const json = await resp.json().catch(() => null);

  if (!resp.ok || !json?.ok) {
    return {
      ok: false,
      error: json?.error ?? { message: `Lookup failed (${resp.status})` }
    };
  }

  return { ok: true, data: json.data };
});

// =========================
// Printer IPC
// =========================
ipcMain.handle("printers:list", async () => {
  try {
    const printers = await listPrinters();
    return { ok: true, printers };
  } catch (e: any) {
    return { ok: false, error: { message: e?.message ?? "Failed to list printers" } };
  }
});

ipcMain.handle("printers:get", async () => {
  return { ok: true, printer_name: getSavedPrinterName() || null };
});

ipcMain.handle("printers:set", async (_evt, { printer_name }: { printer_name: string }) => {
  setSavedPrinterName(printer_name);
  return { ok: true, printer_name: getSavedPrinterName() || null };
});

ipcMain.handle("printers:test", async () => {
  const html = buildReceiptHtml({
    business_name: String(store.get("business_name") ?? ""),
    application_id: "TEST-RECEIPT",
    submitted_at: new Date().toISOString(),
    kiosk_id: String(store.get("kiosk_id") ?? "")
  });

  return await printHtmlSilently(html);
});

ipcMain.handle("printReceipt", async (_evt, payload: { receipt: ReceiptPayload; html?: string }) => {
  try {
    const html =
      payload?.html && String(payload.html).trim()
        ? String(payload.html)
        : buildReceiptHtml(payload?.receipt || {});
    return await printHtmlSilently(html);
  } catch (e: any) {
    return { ok: false, error: { message: e?.message ?? "printReceipt failed" } };
  }
});

// =========================
// Admin-only exit logic
// =========================
async function performAdminExit(pin: string) {
  const p = String(pin ?? "").trim();
  if (!p) return { ok: false, error: { message: "PIN required" } };
  if (p !== ADMIN_EXIT_PIN) return { ok: false, error: { message: "Invalid admin PIN" } };

  allowClose = true;

  try {
    mainWindow?.close();
  } catch {}

  app.quit();
  return { ok: true };
}

ipcMain.handle("adminExit", async (_evt, { pin }: { pin: string }) => performAdminExit(pin));
ipcMain.handle("kioskExit", async (_evt, { pin }: { pin: string }) => performAdminExit(pin));

// =========================
// Email Receipt IPC (manual)
// =========================
ipcMain.handle("sendReceiptEmail", async (_evt, payload: { to_email: string; receipt_text: string }) => {
  try {
    const API_BASE = getApiBase();

    const kioskKey = await getKioskKey();
    if (!kioskKey) {
      return { ok: false, error: { message: "Kiosk key missing. Reset and re-pair." } };
    }

    const to_email = String(payload?.to_email ?? "").trim();
    const receipt_text = String(payload?.receipt_text ?? "").trim();

    if (!to_email) return { ok: false, error: { message: "to_email required" } };
    if (!receipt_text) return { ok: false, error: { message: "receipt_text required" } };

    const resp = await fetch(`${API_BASE}/kiosk/app/email-receipt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KIOSK-KEY": kioskKey
      },
      body: JSON.stringify({ to_email, receipt_text })
    });

    const json = await resp.json().catch(() => null);

    if (!resp.ok || !json?.ok) {
      return {
        ok: false,
        error: json?.error ?? { message: `Email failed (${resp.status})` }
      };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: { message: e?.message ?? "Email send failed" } };
  }
});

// =========================
// ✅ Email Receipt IPC (AUTO → badge email)
// =========================
ipcMain.handle(
  "sendReceiptEmailAuto",
  async (_evt, payload: { badge_token: string; receipt_text: string }) => {
    try {
      const API_BASE = getApiBase();

      const kioskKey = await getKioskKey();
      if (!kioskKey) {
        return { ok: false, error: { message: "Kiosk key missing. Reset and re-pair." } };
      }

      const badge_token = String(payload?.badge_token ?? "").trim();
      const receipt_text = String(payload?.receipt_text ?? "").trim();

      if (!badge_token) return { ok: false, error: { message: "badge_token required" } };
      if (!receipt_text) return { ok: false, error: { message: "receipt_text required" } };

      const resp = await fetch(`${API_BASE}/kiosk/app/email-receipt-auto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-KIOSK-KEY": kioskKey
        },
        body: JSON.stringify({ badge_token, receipt_text })
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok || !json?.ok) {
        return {
          ok: false,
          error: json?.error ?? { message: `Auto-email failed (${resp.status})` }
        };
      }

      // API returns { ok: true, to_email }
      return { ok: true, to_email: json?.to_email ?? null };
    } catch (e: any) {
      return { ok: false, error: { message: e?.message ?? "Auto-email send failed" } };
    }
  }
);
