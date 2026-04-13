const BUSINESS = Object.freeze({
  name: "Shiv Electricals",
  person: "Parth Bhatt",
  phone: "9601716885",
  location: "Nadiad, Gujarat",
  tagline: "Camera And Electrical Service",
});

const STORAGE_KEYS = Object.freeze({
  counter: "shiv.invoiceCounter.v1",
  savedBills: "shiv.savedBills.v1",
  draft: "shiv.draftBill.v1",
});

const fmtMoney = (n) => {
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const clampNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

let pendingPrint = false;
let resetAfterPrint = false;

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

function setText(id, value) {
  el(id).textContent = value;
}

function setOut(key, value) {
  document.querySelectorAll(`[data-out="${CSS.escape(key)}"]`).forEach((n) => {
    n.textContent = value;
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nextInvoiceNumber() {
  const current = clampNumber(localStorage.getItem(STORAGE_KEYS.counter), 0);
  const next = current + 1;
  localStorage.setItem(STORAGE_KEYS.counter, String(next));
  return `SE-${String(next).padStart(5, "0")}`;
}

function buildRow(item = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <input class="it-desc" type="text" placeholder="Work / Item description" value="${escapeHtml(item.desc || "")}">
      <div class="mini">Examples: wiring repair, CCTV install, camera service, switchboard, conduit...</div>
    </td>
    <td class="center"><input class="it-qty" type="number" min="0" step="1" value="${item.qty ?? 1}"></td>
    <td class="num"><input class="it-rate" type="number" min="0" step="0.01" value="${item.rate ?? 0}"></td>
    <td class="num"><span class="it-amt">0.00</span></td>
    <td class="center"><button class="btn danger it-del" type="button" title="Remove">Remove</button></td>
  `;
  return tr;
}

function computeTotals() {
  const rows = [...document.querySelectorAll("#itemsBody tr")];
  let subtotal = 0;

  for (const tr of rows) {
    const qty = clampNumber(tr.querySelector(".it-qty")?.value, 0);
    const rate = clampNumber(tr.querySelector(".it-rate")?.value, 0);
    const amt = Math.max(0, qty) * Math.max(0, rate);
    subtotal += amt;
    const amtNode = tr.querySelector(".it-amt");
    if (amtNode) amtNode.textContent = fmtMoney(amt);
  }

  const discount = Math.max(0, clampNumber(el("discount").value, 0));
  const taxPct = Math.max(0, clampNumber(el("taxPct").value, 0));
  const taxable = Math.max(0, subtotal - discount);
  const tax = taxable * (taxPct / 100);
  const grand = taxable + tax;

  setOut("subtotal", fmtMoney(subtotal));
  setOut("discount", fmtMoney(discount));
  setOut("tax", fmtMoney(tax));
  setOut("grand", fmtMoney(grand));
  setOut("taxLabel", `${taxPct.toFixed(2)}%`);
}

function syncPreview() {
  setOut("invoiceNo", el("invoiceNo").value.trim() || "-");
  setOut("date", el("billDate").value || "-");
  setOut("workType", el("workType").value);

  setOut("custName", el("custName").value.trim() || "-");
  setOut("custPhone", el("custPhone").value.trim() || "-");
  setOut("custAddress", el("custAddress").value.trim() || "-");

  const notes = el("notes").value.trim();
  setOut("notes", notes || "Thank you for your business.");
}

function rebuildPreviewTable() {
  const tbody = el("p_itemsBody");
  tbody.innerHTML = "";

  const rows = [...document.querySelectorAll("#itemsBody tr")];
  rows.forEach((tr, index) => {
    const desc = tr.querySelector(".it-desc")?.value?.trim() || "-";
    const qty = clampNumber(tr.querySelector(".it-qty")?.value, 0);
    const rate = clampNumber(tr.querySelector(".it-rate")?.value, 0);
    const amt = Math.max(0, qty) * Math.max(0, rate);

    const pr = document.createElement("tr");
    pr.innerHTML = `
      <td class="center">${index + 1}</td>
      <td>${escapeHtml(desc)}</td>
      <td class="center">${qty}</td>
      <td class="num">${fmtMoney(rate)}</td>
      <td class="num">${fmtMoney(amt)}</td>
    `;
    tbody.appendChild(pr);
  });
}

function attachRowHandlers(tr) {
  const recompute = () => {
    computeTotals();
    rebuildPreviewTable();
  };

  tr.addEventListener("input", (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.matches(".it-desc,.it-qty,.it-rate")) {
      recompute();
      scheduleDraftSave();
    }
  });

  tr.querySelector(".it-del")?.addEventListener("click", () => {
    const body = el("itemsBody");
    if (body.children.length <= 1) return;
    tr.remove();
    recompute();
    scheduleDraftSave();
  });
}

function setBusinessDetails() {
  setText("bizName", BUSINESS.name);
  setText("bizTag", BUSINESS.tagline);
  setText("bizPerson", BUSINESS.person);
  setText("bizPhone", BUSINESS.phone);
  setText("bizLocation", BUSINESS.location);

  setOut("bizName", BUSINESS.name);
  setOut("bizTag", BUSINESS.tagline);
  setOut("bizPerson", BUSINESS.person);
  setOut("bizPhone", BUSINESS.phone);
  setOut("bizLocation", BUSINESS.location);
}

function printInvoice() {
  // Mobile-friendly: try opening a new tab with invoice-only content (works better on iOS/Android).
  // Fallback to printing the current page (print CSS prints only the invoice).
  const invoiceHtml = el("invoice").outerHTML;

  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) {
    window.print();
    return { mode: "same" };
  }

  w.document.open();
  w.document.write(`<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Invoice ${escapeHtml(el("invoiceNo").value || "")}</title>
    <base href="${escapeHtml(window.location.href)}">
    <link rel="stylesheet" href="styles.css">
    <style>
      body{background:#fff !important}
      .wrap{max-width:none;margin:0;padding:0}
      .paper{box-shadow:none;border:none;border-radius:0}
      .paper .pad{padding:0}
      .invoice .wm{display:block}
      @page{size: A4; margin: 12mm}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="paper"><div class="pad">${invoiceHtml}</div></div>
    </div>
    <script>
      window.addEventListener('load', () => {
        setTimeout(() => window.print(), 250);
      });
    </script>
  </body>
  </html>`);
  w.document.close();
  return { mode: "popup" };
}

function getItemsFromUI() {
  const rows = [...document.querySelectorAll("#itemsBody tr")];
  const items = rows
    .map((tr) => {
      const desc = tr.querySelector(".it-desc")?.value?.trim() || "";
      const qty = Math.max(0, clampNumber(tr.querySelector(".it-qty")?.value, 0));
      const rate = Math.max(0, clampNumber(tr.querySelector(".it-rate")?.value, 0));
      return { desc, qty, rate };
    })
    .filter((it) => it.desc || it.qty > 0 || it.rate > 0);

  return items.length ? items : [{ desc: "", qty: 1, rate: 0 }];
}

function snapshotBill() {
  const invoiceNo = el("invoiceNo").value.trim() || nextInvoiceNumber();
  el("invoiceNo").value = invoiceNo;

  return {
    id: invoiceNo,
    createdAt: new Date().toISOString(),
    invoiceNo,
    billDate: el("billDate").value || todayISO(),
    workType: el("workType").value,
    custName: el("custName").value.trim(),
    custPhone: el("custPhone").value.trim(),
    custAddress: el("custAddress").value.trim(),
    discount: Math.max(0, clampNumber(el("discount").value, 0)),
    taxPct: Math.max(0, clampNumber(el("taxPct").value, 0)),
    notes: el("notes").value.trim(),
    items: getItemsFromUI(),
  };
}

let draftTimer = null;

function saveDraftNow() {
  try {
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(snapshotBill()));
    const hint = document.getElementById("autosaveHint");
    if (hint) hint.textContent = `Autosave: ${new Date().toLocaleTimeString()}`;
  } catch {
    // Ignore draft save errors (quota, private mode, etc.).
  }
}

function scheduleDraftSave() {
  if (draftTimer) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => saveDraftNow(), 800);
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.draft);
    if (!raw) return null;
    const bill = JSON.parse(raw);
    return bill && typeof bill === "object" ? bill : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEYS.draft);
    const hint = document.getElementById("autosaveHint");
    if (hint) hint.textContent = "Autosave: on";
  } catch {
    // Ignore.
  }
}

function readSavedBills() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.savedBills);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeSavedBills(bills) {
  localStorage.setItem(STORAGE_KEYS.savedBills, JSON.stringify(bills));
}

function upsertSavedBill(bill) {
  const bills = readSavedBills();
  const idx = bills.findIndex((b) => b && b.id === bill.id);
  if (idx >= 0) bills[idx] = bill;
  else bills.unshift(bill);
  writeSavedBills(bills.slice(0, 50));
}

function deleteSavedBillById(id) {
  writeSavedBills(readSavedBills().filter((b) => b && b.id !== id));
}

function savedBillLabel(b) {
  const inv = b?.invoiceNo || "-";
  const dt = b?.billDate || "-";
  const name = (b?.custName || "").trim() || "Customer";
  return `${inv} | ${dt} | ${name}`;
}

function getSelectedSavedBill() {
  const id = el("savedBills").value;
  if (!id) return null;
  return readSavedBills().find((b) => b && b.id === id) || null;
}

function refreshSavedBillsUI() {
  const select = el("savedBills");
  const hint = el("savedHint");
  const bills = readSavedBills();

  select.innerHTML = "";
  if (!bills.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No saved bills";
    select.appendChild(opt);
    hint.textContent = "No saved bills yet.";
    return;
  }

  for (const b of bills) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = savedBillLabel(b);
    select.appendChild(opt);
  }
  hint.textContent = `Saved bills: ${bills.length}`;
}

function applyBillToUI(bill) {
  if (!bill) return;

  el("invoiceNo").value = bill.invoiceNo || "";
  el("billDate").value = bill.billDate || todayISO();
  el("workType").value = bill.workType || "Electrical";
  el("custName").value = bill.custName || "";
  el("custPhone").value = bill.custPhone || "";
  el("custAddress").value = bill.custAddress || "";
  el("discount").value = String(clampNumber(bill.discount, 0));
  el("taxPct").value = String(clampNumber(bill.taxPct, 0));
  el("notes").value = bill.notes || "";

  const body = el("itemsBody");
  body.innerHTML = "";
  const items = Array.isArray(bill.items) && bill.items.length ? bill.items : [{ desc: "", qty: 1, rate: 0 }];
  for (const it of items) {
    const tr = buildRow({
      desc: it.desc || "",
      qty: clampNumber(it.qty, 1),
      rate: clampNumber(it.rate, 0),
    });
    body.appendChild(tr);
    attachRowHandlers(tr);
  }

  computeTotals();
  rebuildPreviewTable();
  syncPreview();
  scheduleDraftSave();
}

function resetAll() {
  el("custName").value = "";
  el("custPhone").value = "";
  el("custAddress").value = "";
  el("workType").value = "Electrical";
  el("notes").value = "";
  el("discount").value = "0";
  el("taxPct").value = "0";
  el("billDate").value = todayISO();
  el("invoiceNo").value = nextInvoiceNumber();

  const body = el("itemsBody");
  body.innerHTML = "";
  const tr = buildRow({ desc: "", qty: 1, rate: 0 });
  body.appendChild(tr);
  attachRowHandlers(tr);

  computeTotals();
  rebuildPreviewTable();
  syncPreview();
  clearDraft();
}

function init() {
  setBusinessDetails();

  el("billDate").value = todayISO();
  el("invoiceNo").value = nextInvoiceNumber();

  const tr = buildRow({ desc: "", qty: 1, rate: 0 });
  el("itemsBody").appendChild(tr);
  attachRowHandlers(tr);

  const reflow = () => {
    computeTotals();
    rebuildPreviewTable();
    syncPreview();
  };

  const addItemRow = () => {
    const tr2 = buildRow({ desc: "", qty: 1, rate: 0 });
    el("itemsBody").appendChild(tr2);
    attachRowHandlers(tr2);
    reflow();
    scheduleDraftSave();
  };

  document.addEventListener("input", (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.matches("#custName,#custPhone,#custAddress,#billDate,#invoiceNo,#workType,#notes,#discount,#taxPct")) {
      reflow();
      scheduleDraftSave();
    }
  });

  el("addItem").addEventListener("click", () => addItemRow());
  el("addItemInline").addEventListener("click", () => addItemRow());

  el("generatePdf").addEventListener("click", () => {
    reflow();
    upsertSavedBill(snapshotBill());
    refreshSavedBillsUI();
    saveDraftNow();
    pendingPrint = true;
    const res = printInvoice();
    // If printing happens in a new tab, "afterprint" won't fire here. Clear immediately (bill is saved).
    if (res && res.mode === "popup") setTimeout(() => resetAll(), 300);
  });

  el("saveBill").addEventListener("click", () => {
    reflow();
    upsertSavedBill(snapshotBill());
    refreshSavedBillsUI();
    saveDraftNow();
  });

  el("reset").addEventListener("click", () => resetAll());

  el("loadBill").addEventListener("click", () => {
    const bill = getSelectedSavedBill();
    if (!bill) return;
    applyBillToUI(bill);
  });

  el("deleteBill").addEventListener("click", () => {
    const bill = getSelectedSavedBill();
    if (!bill) return;
    deleteSavedBillById(bill.id);
    refreshSavedBillsUI();
  });

  el("downloadSavedPdf").addEventListener("click", () => {
    const bill = getSelectedSavedBill();
    if (!bill) return;
    applyBillToUI(bill);
    reflow();
    saveDraftNow();
    pendingPrint = true;
    const res = printInvoice();
    if (res && res.mode === "popup") setTimeout(() => resetAll(), 300);
  });

  const draft = loadDraft();
  if (draft) applyBillToUI(draft);

  reflow();
  refreshSavedBillsUI();

  window.addEventListener("beforeunload", () => saveDraftNow());
  window.addEventListener("beforeprint", () => {
    // Some mobile browsers don't really print; only clear if the print lifecycle actually starts.
    if (pendingPrint) resetAfterPrint = true;
  });
  window.addEventListener("afterprint", () => {
    if (!resetAfterPrint) return;
    resetAfterPrint = false;
    pendingPrint = false;
    resetAll();
  });
}

document.addEventListener("DOMContentLoaded", init);
