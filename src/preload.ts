// src/preload.ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("jobappid", {
  // =========================
  // Pairing & kiosk admin
  // =========================
  pair: (code: string) => ipcRenderer.invoke("pair", { code }),
  getStatus: () => ipcRenderer.invoke("getStatus"),
  reset: () => ipcRenderer.invoke("reset"),

  // =========================
  // ✅ API Base (new)
  // =========================
  apiBaseGet: () => ipcRenderer.invoke("apiBase:get"),
  apiBaseSet: (api_base: string) => ipcRenderer.invoke("apiBase:set", { api_base }),

  // =========================
  // Kiosk profile
  // =========================
  kioskMe: () => ipcRenderer.invoke("kioskMe"),

  // =========================
  // Badge Lookup
  // =========================
  badgeLookup: (payload: { badge_token: string }) => ipcRenderer.invoke("badgeLookup", payload),

  // =========================
  // Application submission
  // =========================
  apply: (payload: { badge_token: string; patron_code: string; position_id?: string | null }) =>
    ipcRenderer.invoke("apply", payload),

  // =========================
  // Email receipt (manual entry)
  // =========================
  sendReceiptEmail: (payload: { to_email: string; receipt_text: string }) =>
    ipcRenderer.invoke("sendReceiptEmail", payload),

  // =========================
  // Email receipt (AUTO → badge email)
  // =========================
  sendReceiptEmailAuto: (payload: { badge_token: string; receipt_text: string }) =>
    ipcRenderer.invoke("sendReceiptEmailAuto", payload),

  // =========================
  // Admin-only exit
  // =========================
  adminExit: (pin: string) => ipcRenderer.invoke("adminExit", { pin }),
  kioskExit: (pin: string) => ipcRenderer.invoke("kioskExit", { pin }),

  // =========================
  // 🖨️ Printer / Receipt API (canonical names)
  // =========================
  printersList: () => ipcRenderer.invoke("printers:list"),
  printersGet: () => ipcRenderer.invoke("printers:get"),
  printersSet: (printer_name: string) => ipcRenderer.invoke("printers:set", { printer_name }),
  printersTest: () => ipcRenderer.invoke("printers:test"),
  printReceipt: (payload: { receipt?: any; html?: string }) =>
    ipcRenderer.invoke("printReceipt", payload),

  // =========================
  // 🧩 Backward-compat aliases (optional)
  // =========================
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  getPrinterConfig: () => ipcRenderer.invoke("printers:get"),
  setPrinterConfig: (printer_name: string) => ipcRenderer.invoke("printers:set", { printer_name }),
  testPrint: () => ipcRenderer.invoke("printers:test")
});
