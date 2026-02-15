const roles = [
  "Primary Admin", "Super Admin", "Sales Manager", "Sales Executive", "PPC Manager",
  "Store Manager", "Store Operator", "Production Supervisor", "Machine Operator",
  "QC Manager", "QC Analyst", "Accounts Manager", "Accounts Executive", "Basic User"
];

const state = {
  currentRole: "Primary Admin",
  enquiries: [],
  quotations: [],
  workOrders: [],
  salesOrders: [],
  productionOrders: [],
  qcReports: [],
  ncr: [],
  documents: [],
  notifications: [],
  auditLogs: []
};

const emptyState = {
  currentRole: "Primary Admin",
  enquiries: [],
  quotations: [],
  workOrders: [],
  salesOrders: [],
  productionOrders: [],
  qcReports: [],
  ncr: [],
  documents: [],
  notifications: [],
  auditLogs: []
};

const LOCAL_STATE_KEY = "ad_erp_local_state_v1";
let supabaseClient = null;
let isCloudMode = false;
let currentUser = null;
let persistTimer = null;

function id(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function resetState() {
  Object.assign(state, JSON.parse(JSON.stringify(emptyState)));
}

function normalizeStateShape(raw) {
  const base = JSON.parse(JSON.stringify(emptyState));
  return Object.assign(base, raw || {});
}

function setAuthMessage(msg, isError = false) {
  const el = document.getElementById("authMessage");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function updateModeUi() {
  const mode = document.getElementById("backendMode");
  const user = document.getElementById("userEmail");
  if (mode) mode.value = isCloudMode ? "Supabase Cloud" : "Local Demo";
  if (user) user.value = currentUser?.email || "guest";
}

function showApp() {
  const app = document.getElementById("appRoot");
  const auth = document.getElementById("authGate");
  if (app) app.style.display = "grid";
  if (auth) auth.style.display = "none";
}

function showAuth() {
  const app = document.getElementById("appRoot");
  const auth = document.getElementById("authGate");
  if (app) app.style.display = "none";
  if (auth) auth.style.display = "flex";
}

function saveLocalState() {
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (raw) Object.assign(state, normalizeStateShape(JSON.parse(raw)));
  } catch (_e) {
    resetState();
  }
}

async function saveCloudState() {
  if (!supabaseClient || !currentUser) return;
  const payload = { user_id: currentUser.id, state_json: state, updated_at: new Date().toISOString() };
  const { error } = await supabaseClient.from("erp_state").upsert(payload, { onConflict: "user_id" });
  if (error) {
    console.error(error);
    notify("Cloud Save Failed", "Could not persist latest data to Supabase", "warn");
  }
}

async function loadCloudState() {
  if (!supabaseClient || !currentUser) return false;
  const { data, error } = await supabaseClient
    .from("erp_state")
    .select("state_json")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) {
    console.error(error);
    return false;
  }
  if (data?.state_json) {
    Object.assign(state, normalizeStateShape(data.state_json));
    return true;
  }
  return false;
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    if (isCloudMode) {
      await saveCloudState();
    } else {
      saveLocalState();
    }
  }, 250);
}

async function initSupabaseAndAuth() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url || !cfg?.anonKey || !window.supabase?.createClient) {
    isCloudMode = false;
    showApp();
    loadLocalState();
    if (!state.enquiries.length) seed(false);
    updateModeUi();
    renderAll();
    return;
  }

  supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
  isCloudMode = true;
  updateModeUi();

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data?.session?.user || null;
  if (currentUser) {
    const loaded = await loadCloudState();
    if (!loaded) seed(false);
    showApp();
    updateModeUi();
    renderAll();
  } else {
    showAuth();
    setAuthMessage("Sign in to continue.");
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    updateModeUi();
    if (currentUser) {
      const loaded = await loadCloudState();
      if (!loaded) seed(false);
      showApp();
      renderAll();
    } else if (isCloudMode) {
      showAuth();
      setAuthMessage("Signed out.");
    }
  });
}

async function signIn() {
  if (!supabaseClient) return;
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) {
    setAuthMessage("Enter email and password.", true);
    return;
  }
  setAuthMessage("Signing in...");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) setAuthMessage(error.message, true);
}

async function signUp() {
  if (!supabaseClient) return;
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) {
    setAuthMessage("Enter email and password.", true);
    return;
  }
  setAuthMessage("Creating account...");
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    setAuthMessage(error.message, true);
  } else {
    setAuthMessage("Account created. Check email if confirmation is enabled.");
  }
}

async function signOut() {
  if (!isCloudMode || !supabaseClient) return;
  await supabaseClient.auth.signOut();
}

function audit(action, entityType, entityId, oldValue, newValue) {
  state.auditLogs.unshift({
    id: id("AUD"),
    actor: state.currentRole,
    timestamp: now(),
    ip: "127.0.0.1",
    action,
    entityType,
    entityId,
    oldValue,
    newValue
  });
}

function notify(title, body, severity = "info") {
  state.notifications.unshift({ id: id("NTF"), title, body, severity, at: now(), read: false });
}

function generateDocument(docType, referenceType, referenceId) {
  const doc = {
    id: id("DOC"),
    type: docType,
    referenceType,
    referenceId,
    version: 1,
    hash: cryptoRandomHash(),
    generatedAt: now(),
    generatedBy: state.currentRole
  };
  state.documents.unshift(doc);
  audit("DOCUMENT_GENERATED", "document", doc.id, null, doc);
  notify(`${docType} Generated`, `${docType} for ${referenceType} ${referenceId}`, "info");
}

function cryptoRandomHash() {
  const chars = "abcdef0123456789";
  let out = "";
  for (let i = 0; i < 24; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function pdfEscape(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfText(text, maxChars) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function buildStyledWorkOrderPdfBlob(workOrder) {
  const header = "%PDF-1.4\n";
  const c = [];
  const pageLeft = 35;
  const pageBottom = 35;
  const pageWidth = 595 - (pageLeft * 2);
  let y = 805;

  const text = (value, x, yPos, size = 10, bold = false) => {
    c.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${yPos} Tm (${pdfEscape(value)}) Tj ET`);
  };
  const line = (x1, y1, x2, y2, width = 0.8) => {
    c.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const rect = (x, yPos, w, h, width = 0.8) => {
    c.push(`${width} w ${x} ${yPos} ${w} ${h} re S`);
  };

  rect(pageLeft, pageBottom, pageWidth, 772, 1.2);
  rect(pageLeft, y - 40, pageWidth, 40, 1.2);
  text("SAMPLE WORK ORDER STANDARD TEMPLATE / V1", pageLeft + 12, y - 24, 13, true);
  text("WORK ORDER", pageLeft + pageWidth - 110, y - 24, 12, true);
  y -= 58;

  text(`Date: ${workOrder.date}`, pageLeft + 12, y, 10, false);
  text(`Document No.: ${workOrder.documentNo}`, pageLeft + 170, y, 10, false);
  text("Team: CEO + PPC", pageLeft + pageWidth - 115, y, 10, false);
  y -= 14;
  line(pageLeft, y, pageLeft + pageWidth, y, 1);
  y -= 18;

  text("Primary Information", pageLeft + 10, y, 11, true);
  y -= 10;
  rect(pageLeft + 8, y - 128, pageWidth - 16, 128, 0.9);
  line(pageLeft + 45, y, pageLeft + 45, y - 128, 0.7);
  line(pageLeft + 245, y, pageLeft + 245, y - 128, 0.7);
  line(pageLeft + pageWidth - 80, y, pageLeft + pageWidth - 80, y - 128, 0.7);

  const pRows = [
    ["1", "Sample Work Order No. & Date", `${workOrder.workOrderNo} / ${workOrder.date}`, "PPC F1"],
    ["2", "Client Name", workOrder.clientName, ""],
    ["3", "Enquiry Promoter", workOrder.enquiryPromoter, ""],
    ["4", "Dispatch Due Date", workOrder.dispatchDueDate, ""],
    ["5", "Enquiry Type", workOrder.enquiryType, ""],
    ["6", "Courier Name", workOrder.courierName, ""]
  ];
  const rowTop = y - 16;
  const rowH = 18;
  text("No.", pageLeft + 15, y - 12, 9, true);
  text("Particular", pageLeft + 54, y - 12, 9, true);
  text("Details", pageLeft + 254, y - 12, 9, true);
  text("Remark", pageLeft + pageWidth - 72, y - 12, 9, true);
  for (let i = 0; i <= pRows.length; i++) {
    line(pageLeft + 8, rowTop - (i * rowH), pageLeft + pageWidth - 8, rowTop - (i * rowH), 0.6);
  }
  pRows.forEach((r, i) => {
    const yy = rowTop - (i * rowH) - 13;
    text(r[0], pageLeft + 18, yy, 9, false);
    text(r[1], pageLeft + 54, yy, 9, false);
    text(r[2], pageLeft + 254, yy, 9, false);
    text(r[3], pageLeft + pageWidth - 72, yy, 9, false);
  });
  y -= 146;

  text("Product Details", pageLeft + 10, y, 11, true);
  y -= 10;
  rect(pageLeft + 8, y - 58, pageWidth - 16, 58, 0.9);
  line(pageLeft + 40, y, pageLeft + 40, y - 58, 0.7);
  line(pageLeft + 290, y, pageLeft + 290, y - 58, 0.7);
  line(pageLeft + 405, y, pageLeft + 405, y - 58, 0.7);
  line(pageLeft + 8, y - 20, pageLeft + pageWidth - 8, y - 20, 0.6);
  text("Sr.", pageLeft + 14, y - 13, 9, true);
  text("Name of the Product", pageLeft + 52, y - 13, 9, true);
  text("Quantity In gm", pageLeft + 300, y - 13, 9, true);
  text("HSN/SAC", pageLeft + 418, y - 13, 9, true);
  text("1", pageLeft + 16, y - 37, 9, false);
  text(workOrder.productName, pageLeft + 52, y - 37, 9, false);
  text(String(workOrder.quantityGm), pageLeft + 300, y - 37, 9, false);
  text(workOrder.hsnSac, pageLeft + 418, y - 37, 9, false);
  y -= 74;

  text("Specification Details", pageLeft + 10, y, 11, true);
  y -= 10;
  rect(pageLeft + 8, y - 100, pageWidth - 16, 100, 0.9);
  line(pageLeft + 40, y, pageLeft + 40, y - 100, 0.7);
  line(pageLeft + 220, y, pageLeft + 220, y - 100, 0.7);
  for (let i = 1; i <= 4; i++) {
    line(pageLeft + 8, y - (i * 25), pageLeft + pageWidth - 8, y - (i * 25), 0.6);
  }
  const specs = [
    ["1", "Product Size", workOrder.productSize],
    ["2", "Specific Requirements", workOrder.specificRequirements],
    ["3", "Type of Packaging", workOrder.packagingType],
    ["4", "Reference Sample", workOrder.referenceSample]
  ];
  specs.forEach((s, i) => {
    const yy = y - (i * 25) - 16;
    text(s[0], pageLeft + 16, yy, 9, false);
    text(s[1], pageLeft + 48, yy, 9, false);
    wrapPdfText(s[2], 56).slice(0, 2).forEach((w, idx) => text(w, pageLeft + 228, yy - (idx * 10), 9, false));
  });
  y -= 116;

  text("Dispatch Details", pageLeft + 10, y, 11, true);
  y -= 10;
  rect(pageLeft + 8, y - 76, pageWidth - 16, 76, 0.9);
  line(pageLeft + 175, y, pageLeft + 175, y - 76, 0.7);
  line(pageLeft + 340, y, pageLeft + 340, y - 76, 0.7);
  for (let i = 1; i <= 3; i++) {
    line(pageLeft + 8, y - (i * 25), pageLeft + pageWidth - 8, y - (i * 25), 0.6);
  }
  text("Concern Person", pageLeft + 14, y - 16, 9, true);
  text(workOrder.concernPerson, pageLeft + 182, y - 16, 9, false);
  text("Courier/Transporter", pageLeft + 346, y - 16, 9, true);
  text(workOrder.courierTransporterDetails, pageLeft + 346, y - 27, 8.5, false);
  text("Delivery At", pageLeft + 14, y - 41, 9, true);
  wrapPdfText(workOrder.deliveryAt, 38).slice(0, 2).forEach((w, idx) => text(w, pageLeft + 182, y - 41 - (idx * 10), 9, false));
  y -= 96;

  line(pageLeft + 8, y, pageLeft + pageWidth - 8, y, 1);
  text("Prepared by: Admin Manager", pageLeft + 14, y - 16, 9.5, false);
  text("Verified by: PPC in charge", pageLeft + 205, y - 16, 9.5, false);
  text("Authorized by: CEO", pageLeft + 410, y - 16, 9.5, false);

  const content = c.join("\n");

  const objs = [];
  objs.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objs.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objs.push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>\nendobj\n");
  objs.push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  objs.push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  objs.push("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

  let body = "";
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push((header + body).length);
    body += objs[i];
  }
  const xrefStart = (header + body).length;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Blob([header, body, xref, trailer], { type: "application/pdf" });
}

function createWorkOrderFromQuotation(quotation, enquiry) {
  const workOrder = {
    id: id("WO"),
    quotationId: quotation.id,
    workOrderNo: `PTPL-${quotation.id.replace("QUO-", "")}`,
    date: today(),
    documentNo: "PTPL/MIS/PPC/SWO/2024-25/V1",
    clientName: quotation.customer,
    enquiryPromoter: "PTPL/ HO/ Padma",
    dispatchDueDate: enquiry.deliveryDate,
    enquiryType: "Sales Enquiry",
    courierName: "To be assigned",
    productName: quotation.product,
    quantityGm: quotation.qty,
    hsnSac: "N/A",
    productSize: "Standard",
    specificRequirements: "As per agreed quotation",
    packagingType: "Standard export packing",
    referenceSample: "Customer-approved sample",
    concernPerson: quotation.customer,
    deliveryAt: "Customer dispatch address",
    courierTransporterDetails: "Pending confirmation"
  };
  state.workOrders.unshift(workOrder);
  audit("CREATE", "work_order", workOrder.id, null, workOrder);
  generateDocument("Work Order", "quotation", quotation.id);
  notify("Work Order Created", `${workOrder.id} is ready for PDF download`, "info");
}

function downloadWorkOrderPdf(quotationId) {
  const workOrder = state.workOrders.find(w => w.quotationId === quotationId);
  if (!workOrder) return;
  const pdf = buildStyledWorkOrderPdfBlob(workOrder);
  const url = URL.createObjectURL(pdf);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${workOrder.workOrderNo}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  audit("EXPORT", "work_order", workOrder.id, null, { format: "pdf" });
}

function seed(shouldRender = true) {
  resetState();
  state.enquiries = [
    { id: "ENQ-1001", customer: "SunDry Foods", product: "Dehydrated Onion", qty: 5000, deliveryDate: "2026-03-02", aiScore: 81, status: "OPEN", assignedTo: "Sales Executive" },
    { id: "ENQ-1002", customer: "AgriNova", product: "Dehydrated Garlic", qty: 3200, deliveryDate: "2026-02-25", aiScore: 68, status: "FOLLOWUP", assignedTo: "Sales Executive" }
  ];
  notify("Demo Ready", "Live ERP demo initialized with sample enquiries", "info");
  audit("SEED", "system", "seed", null, { ok: true });
  if (shouldRender) renderAll();
}

function addEnquiry(formData) {
  const enquiry = {
    id: id("ENQ"),
    customer: formData.customer,
    product: formData.product,
    qty: Number(formData.qty),
    deliveryDate: formData.deliveryDate,
    aiScore: Number(formData.aiScore),
    status: "OPEN",
    assignedTo: "Sales Executive"
  };
  state.enquiries.unshift(enquiry);
  audit("CREATE", "enquiry", enquiry.id, null, enquiry);
  notify("New Enquiry", `${enquiry.id} created for ${enquiry.customer}`, "info");
  renderAll();
}

function createQuotationFromEnquiry(enquiryId) {
  const enq = state.enquiries.find(e => e.id === enquiryId);
  if (!enq) return;
  const margin = Math.floor(Math.random() * 18) + 4;
  const quotation = {
    id: id("QUO"),
    enquiryId,
    customer: enq.customer,
    product: enq.product,
    qty: enq.qty,
    margin,
    status: margin < 10 ? "PENDING_APPROVAL" : "APPROVED",
    expiresOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  };
  state.quotations.unshift(quotation);
  enq.status = "QUOTED";
  audit("CREATE", "quotation", quotation.id, null, quotation);
  createWorkOrderFromQuotation(quotation, enq);
  if (quotation.status === "PENDING_APPROVAL") {
    notify("Approval Needed", `${quotation.id} below margin threshold`, "warn");
  } else {
    notify("Quotation Auto-Approved", `${quotation.id} passed margin validation`, "info");
    generateDocument("Quotation", "quotation", quotation.id);
  }
  renderAll();
}

function approveQuotation(quotationId) {
  const q = state.quotations.find(x => x.id === quotationId);
  if (!q) return;
  const old = { ...q };
  q.status = "APPROVED";
  audit("APPROVE", "quotation", q.id, old, q);
  generateDocument("Quotation", "quotation", q.id);
  renderAll();
}

function rejectQuotation(quotationId) {
  const q = state.quotations.find(x => x.id === quotationId);
  if (!q) return;
  const old = { ...q };
  q.status = "REJECTED";
  audit("REJECT", "quotation", q.id, old, q);
  notify("Quotation Rejected", `${q.id} rejected`, "error");
  renderAll();
}

function createSalesOrder(quotationId) {
  const q = state.quotations.find(x => x.id === quotationId && x.status === "APPROVED");
  if (!q) return;
  const so = {
    id: id("SO"),
    quotationId: q.id,
    customer: q.customer,
    product: q.product,
    qty: q.qty,
    creditStatus: Math.random() > 0.2 ? "CLEARED" : "HOLD",
    status: "CONFIRMED"
  };
  state.salesOrders.unshift(so);
  audit("CREATE", "sales_order", so.id, null, so);
  generateDocument("Sales Order", "sales_order", so.id);
  if (so.creditStatus === "HOLD") {
    notify("Credit Hold", `${so.id} blocked by credit validation`, "warn");
  } else {
    notify("Sales Order Confirmed", `${so.id} triggered PPC and Accounts`, "info");
  }
  renderAll();
}

function createProductionOrder(salesOrderId) {
  const so = state.salesOrders.find(x => x.id === salesOrderId && x.creditStatus === "CLEARED");
  if (!so) return;
  const po = {
    id: id("PO"),
    salesOrderId: so.id,
    product: so.product,
    qty: so.qty,
    shortage: Math.random() > 0.6,
    status: "PLANNED"
  };
  state.productionOrders.unshift(po);
  audit("CREATE", "production_order", po.id, null, po);
  notify("Production Order Created", `${po.id} created from ${so.id}`, "info");
  if (po.shortage) notify("MRP Shortage", `${po.id} has material shortage`, "warn");
  renderAll();
}

function runQC(productionOrderId, qcStatus) {
  const po = state.productionOrders.find(x => x.id === productionOrderId);
  if (!po) return;
  const report = {
    id: id("QC"),
    productionOrderId,
    moisture: (Math.random() * 5 + 2).toFixed(2),
    color: "Standard",
    texture: "Granular",
    status: qcStatus
  };
  state.qcReports.unshift(report);
  audit("CREATE", "qc_report", report.id, null, report);
  generateDocument("QC Report", "qc_report", report.id);
  if (qcStatus === "FAILED") {
    const n = { id: id("NCR"), qcReportId: report.id, status: "OPEN", rootCause: "Moisture variance" };
    state.ncr.unshift(n);
    audit("CREATE", "ncr", n.id, null, n);
    generateDocument("NCR", "ncr", n.id);
    notify("QC Failed", `${report.id} created NCR ${n.id}`, "error");
  } else {
    generateDocument("COA", "qc_report", report.id);
    notify("QC Passed", `${report.id} triggered COA generation`, "info");
  }
  renderAll();
}

function badge(status) {
  if (["APPROVED", "PASSED", "CLEARED", "CONFIRMED", "OPEN"].includes(status)) return `<span class="badge ok">${status}</span>`;
  if (["PENDING_APPROVAL", "HOLD", "FOLLOWUP"].includes(status)) return `<span class="badge hold">${status}</span>`;
  if (["REJECTED", "FAILED"].includes(status)) return `<span class="badge fail">${status}</span>`;
  return `<span class="badge">${status}</span>`;
}

function dashboardHtml() {
  const pendingApprovals = state.quotations.filter(q => q.status === "PENDING_APPROVAL").length;
  const qualityAlerts = state.qcReports.filter(q => q.status === "FAILED").length;
  const stockAlerts = state.productionOrders.filter(p => p.shortage).length;
  const overdue = state.notifications.filter(n => n.severity === "warn" || n.severity === "error").length;

  return `
    <div class="grid">
      <div class="card"><small>Today's Tasks</small><div class="kpi">${state.notifications.length}</div></div>
      <div class="card"><small>Pending Approvals</small><div class="kpi">${pendingApprovals}</div></div>
      <div class="card"><small>Stock Alerts</small><div class="kpi">${stockAlerts}</div></div>
      <div class="card"><small>Quality Alerts</small><div class="kpi">${qualityAlerts}</div></div>
    </div>
    <div class="panel">
      <h3>Workflow Health</h3>
      <p>Overdue/Escalation candidates: <b>${overdue}</b></p>
      <p>Documents generated: <b>${state.documents.length}</b> | Audit events: <b>${state.auditLogs.length}</b></p>
    </div>
  `;
}

function crmHtml() {
  return `
    <div class="panel">
      <h3>Create Enquiry</h3>
      <form id="enquiryForm">
        <div class="row">
          <input name="customer" placeholder="Customer" required />
          <input name="product" placeholder="Product" required />
          <input name="qty" type="number" placeholder="Quantity" required />
          <input name="deliveryDate" type="date" required />
        </div>
        <div class="row-2">
          <input name="aiScore" type="number" min="1" max="99" value="75" required />
          <button class="primary" type="submit">Create Enquiry</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h3>Enquiries</h3>
      <table><thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Qty</th><th>AI Score</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
      ${state.enquiries.map(e => `
        <tr>
          <td>${e.id}</td><td>${e.customer}</td><td>${e.product}</td><td>${e.qty}</td><td>${e.aiScore}</td><td>${badge(e.status)}</td>
          <td class="actions"><button onclick="createQuotationFromEnquiry('${e.id}')">Create Quotation</button></td>
        </tr>`).join("")}
      </tbody></table>
    </div>

    <div class="panel">
      <h3>Quotations</h3>
      <table><thead><tr><th>ID</th><th>Customer</th><th>Margin%</th><th>Status</th><th>Expires</th><th>Work Order</th><th>Actions</th></tr></thead>
      <tbody>
      ${state.quotations.map(q => `
        <tr>
          <td>${q.id}</td><td>${q.customer}</td><td>${q.margin}</td><td>${badge(q.status)}</td><td>${q.expiresOn}</td>
          <td class="actions">${state.workOrders.some(w => w.quotationId === q.id) ? `<button onclick="downloadWorkOrderPdf('${q.id}')">Download PDF</button>` : `<small>Not ready</small>`}</td>
          <td class="actions">
            ${state.workOrders.some(w => w.quotationId === q.id) ? `<button onclick="downloadWorkOrderPdf('${q.id}')">Download PDF</button>` : ""}
            ${q.status === "PENDING_APPROVAL" ? `<button onclick="approveQuotation('${q.id}')">Approve</button><button onclick="rejectQuotation('${q.id}')">Reject</button>` : ""}
            ${q.status === "APPROVED" ? `<button class="primary" onclick="createSalesOrder('${q.id}')">Create SO</button>` : ""}
          </td>
        </tr>`).join("")}
      </tbody></table>
    </div>

    <div class="panel">
      <h3>Sales Orders</h3>
      <table><thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Qty</th><th>Credit</th><th>Actions</th></tr></thead>
      <tbody>
      ${state.salesOrders.map(so => `
        <tr>
          <td>${so.id}</td><td>${so.customer}</td><td>${so.product}</td><td>${so.qty}</td><td>${badge(so.creditStatus)}</td>
          <td class="actions">${so.creditStatus === "CLEARED" ? `<button onclick="createProductionOrder('${so.id}')">Trigger Production</button>` : `<small>Await accounts clearance</small>`}</td>
        </tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function productionHtml() {
  return `
    <div class="panel">
      <h3>Production Orders</h3>
      <table><thead><tr><th>ID</th><th>Sales Order</th><th>Product</th><th>Qty</th><th>Shortage</th><th>QC Actions</th></tr></thead>
      <tbody>
      ${state.productionOrders.map(po => `
        <tr>
          <td>${po.id}</td><td>${po.salesOrderId}</td><td>${po.product}</td><td>${po.qty}</td><td>${po.shortage ? badge("HOLD") : badge("CLEARED")}</td>
          <td class="actions">
            <button onclick="runQC('${po.id}','PASSED')">Run QC Pass</button>
            <button onclick="runQC('${po.id}','FAILED')">Run QC Fail</button>
          </td>
        </tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function qcHtml() {
  return `
    <div class="panel">
      <h3>QC Reports</h3>
      <table><thead><tr><th>ID</th><th>Production Order</th><th>Moisture%</th><th>Status</th></tr></thead><tbody>
      ${state.qcReports.map(r => `<tr><td>${r.id}</td><td>${r.productionOrderId}</td><td>${r.moisture}</td><td>${badge(r.status)}</td></tr>`).join("")}
      </tbody></table>
    </div>
    <div class="panel">
      <h3>NCR</h3>
      <table><thead><tr><th>ID</th><th>QC Report</th><th>Root Cause</th><th>Status</th></tr></thead><tbody>
      ${state.ncr.map(n => `<tr><td>${n.id}</td><td>${n.qcReportId}</td><td>${n.rootCause}</td><td>${badge(n.status)}</td></tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function documentsHtml() {
  return `
    <div class="panel">
      <h3>Generated Documents</h3>
      <table><thead><tr><th>ID</th><th>Type</th><th>Reference</th><th>Version</th><th>Hash</th><th>At</th></tr></thead><tbody>
      ${state.documents.map(d => `<tr><td>${d.id}</td><td>${d.type}</td><td>${d.referenceType}:${d.referenceId}</td><td>v${d.version}</td><td><code>${d.hash}</code></td><td>${d.generatedAt}</td></tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function notificationsHtml() {
  return `
    <div class="panel">
      <h3>Notifications</h3>
      <table><thead><tr><th>ID</th><th>At</th><th>Title</th><th>Body</th><th>Severity</th></tr></thead><tbody>
      ${state.notifications.map(n => `<tr><td>${n.id}</td><td>${n.at}</td><td>${n.title}</td><td>${n.body}</td><td>${badge(n.severity.toUpperCase())}</td></tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function auditHtml() {
  return `
    <div class="panel">
      <h3>Immutable Audit Trail</h3>
      <table><thead><tr><th>ID</th><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead><tbody>
      ${state.auditLogs.map(a => `<tr><td>${a.id}</td><td>${a.timestamp}</td><td>${a.actor}</td><td>${a.action}</td><td>${a.entityType}:${a.entityId}</td><td>${a.ip}</td></tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function renderAll() {
  document.getElementById("dashboard").innerHTML = dashboardHtml();
  document.getElementById("crm").innerHTML = crmHtml();
  document.getElementById("production").innerHTML = productionHtml();
  document.getElementById("qc").innerHTML = qcHtml();
  document.getElementById("documents").innerHTML = documentsHtml();
  document.getElementById("notifications").innerHTML = notificationsHtml();
  document.getElementById("audit").innerHTML = auditHtml();

  const form = document.getElementById("enquiryForm");
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      addEnquiry(data);
      form.reset();
    };
  }
  schedulePersist();
}

function setupNav() {
  const navBtns = document.querySelectorAll(".nav-btn");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      navBtns.forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.screen;
      document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
      document.getElementById(target).classList.add("active");
      document.getElementById("screenTitle").textContent = btn.textContent;
    });
  });
}

function setupRoleSelect() {
  const sel = document.getElementById("roleSelect");
  sel.innerHTML = roles.map(r => `<option>${r}</option>`).join("");
  sel.value = state.currentRole;
  sel.onchange = () => {
    state.currentRole = sel.value;
    notify("Role Changed", `Switched to ${state.currentRole}`, "info");
    renderAll();
  };
}

window.createQuotationFromEnquiry = createQuotationFromEnquiry;
window.approveQuotation = approveQuotation;
window.rejectQuotation = rejectQuotation;
window.createSalesOrder = createSalesOrder;
window.createProductionOrder = createProductionOrder;
window.runQC = runQC;
window.downloadWorkOrderPdf = downloadWorkOrderPdf;

document.getElementById("seedBtn").onclick = () => seed(true);
document.getElementById("signOutBtn").onclick = signOut;
document.getElementById("signInBtn").onclick = signIn;
document.getElementById("signUpBtn").onclick = signUp;
setupNav();
setupRoleSelect();
initSupabaseAndAuth();
