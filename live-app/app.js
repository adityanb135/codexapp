const MODULES = [
  { key: "super_admin", label: "Super Admin", pages: ["Dashboard", "Users", "Access Control", "Audit", "Analytics"] },
  { key: "purchase", label: "Purchase", pages: ["Requisitions", "Vendors", "GRN"] },
  { key: "sales", label: "Sales", pages: ["Enquiries", "Quotations", "Sales Orders"] },
  { key: "master_data", label: "Master Data", pages: ["Products", "Customers", "BOM"] },
  { key: "pre_processing", label: "Pre-Processing", pages: ["Batch Intake", "Wash & Sort"] },
  { key: "inspection", label: "Inspection", pages: ["QC Entry", "NCR"] },
  { key: "size_reduction", label: "Size Reduction", pages: ["Job Cards", "Machine Logs"] },
  { key: "invoicing", label: "Invoicing", pages: ["Invoices", "Payments"] },
  { key: "packaging", label: "Packaging", pages: ["Packing Slips", "Labels"] },
  { key: "dispatch", label: "Dispatch", pages: ["Dispatch Orders", "Tracking"] }
];

const LOCAL_STATE_KEY = "agri_erp_modern_state_v2";
let supabaseClient = null;
let isCloudMode = false;
let currentUser = null;
let persistTimer = null;

const state = {
  ui: { activeModule: "super_admin", activePage: "Dashboard" },
  appUsers: [],
  currentRole: "Super Admin",
  enquiries: [],
  quotations: [],
  workOrders: [],
  salesOrders: [],
  purchaseRequisitions: [],
  vendors: [],
  grn: [],
  products: [],
  customers: [],
  bom: [],
  preProcessing: [],
  washSort: [],
  qcReports: [],
  ncr: [],
  jobCards: [],
  machineLogs: [],
  invoices: [],
  payments: [],
  packingSlips: [],
  labels: [],
  dispatchOrders: [],
  notifications: [],
  auditLogs: [],
  documents: []
};

const emptyState = JSON.parse(JSON.stringify(state));

function id(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function resetState() {
  Object.assign(state, clone(emptyState));
}

function defaultPermissionsForRole(role) {
  const perms = {};
  for (const m of MODULES) {
    const allPages = {};
    for (const p of m.pages) allPages[p] = false;
    perms[m.key] = { enabled: false, pages: allPages };
  }

  if (role === "Super Admin") {
    for (const m of MODULES) {
      perms[m.key].enabled = true;
      for (const p of m.pages) perms[m.key].pages[p] = true;
    }
    return perms;
  }

  const map = {
    "Sales Manager": ["sales"],
    "Purchase Manager": ["purchase"],
    "QC Manager": ["inspection"],
    "Accounts Manager": ["invoicing"],
    "Production Supervisor": ["pre_processing", "size_reduction", "packaging", "dispatch"],
    "Master Data Admin": ["master_data"]
  };
  const enabled = map[role] || ["sales"];
  for (const key of enabled) {
    perms[key].enabled = true;
    const module = MODULES.find(m => m.key === key);
    for (const p of module.pages) perms[key].pages[p] = true;
  }
  return perms;
}

function normalizeStateShape(raw) {
  const n = clone(emptyState);
  if (!raw || typeof raw !== "object") return n;
  Object.assign(n, raw);
  if (!n.ui) n.ui = clone(emptyState.ui);
  return n;
}

function setAuthMessage(msg, isError = false) {
  const el = document.getElementById("authMessage");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function showApp() {
  const app = document.getElementById("appRoot");
  const auth = document.getElementById("authGate");
  app.style.display = "grid";
  auth.style.display = "none";
}

function showAuth() {
  const app = document.getElementById("appRoot");
  const auth = document.getElementById("authGate");
  app.style.display = "none";
  auth.style.display = "flex";
}

function updateTopStatus() {
  document.getElementById("backendMode").value = isCloudMode ? "Supabase Cloud" : "Local Demo";
  document.getElementById("userEmail").value = currentUser?.email || "guest";

  const activeAppUser = getCurrentAppUser();
  document.getElementById("userRoleText").textContent = `${activeAppUser?.role || "No Role"}`;
}

function getCurrentAppUser() {
  if (!currentUser?.email) return state.appUsers[0] || null;
  return state.appUsers.find(u => u.email.toLowerCase() === currentUser.email.toLowerCase()) || state.appUsers[0] || null;
}

function ensureCurrentUserProfile() {
  if (!currentUser?.email) return;
  let profile = state.appUsers.find(u => u.email.toLowerCase() === currentUser.email.toLowerCase());
  if (!profile) {
    const role = state.appUsers.length === 0 ? "Super Admin" : "Sales Manager";
    profile = {
      id: id("USR"),
      name: currentUser.email.split("@")[0],
      email: currentUser.email,
      role,
      permissions: defaultPermissionsForRole(role),
      status: "ACTIVE"
    };
    state.appUsers.push(profile);
    audit("CREATE", "user", profile.id, null, profile);
  }
}

function canAccess(moduleKey, page) {
  const user = getCurrentAppUser();
  if (!user) return false;
  const perm = user.permissions[moduleKey];
  if (!perm || !perm.enabled) return false;
  return !!perm.pages[page];
}

function firstAccessibleModuleAndPage() {
  const user = getCurrentAppUser();
  if (!user) return { module: MODULES[0], page: MODULES[0].pages[0] };
  for (const m of MODULES) {
    const perm = user.permissions[m.key];
    if (perm?.enabled) {
      for (const p of m.pages) {
        if (perm.pages[p]) return { module: m, page: p };
      }
    }
  }
  return { module: MODULES[0], page: MODULES[0].pages[0] };
}

function audit(action, entityType, entityId, oldValue, newValue) {
  state.auditLogs.unshift({
    id: id("AUD"),
    actor: currentUser?.email || "guest",
    role: getCurrentAppUser()?.role || "Unknown",
    timestamp: now(),
    ip: "127.0.0.1",
    action,
    entityType,
    entityId,
    oldValue,
    newValue
  });
}

function notify(title, body, severity = "neutral") {
  state.notifications.unshift({ id: id("NTF"), title, body, severity, at: now() });
}

function saveLocalState() {
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return false;
    Object.assign(state, normalizeStateShape(JSON.parse(raw)));
    return true;
  } catch (_e) {
    return false;
  }
}

async function saveCloudState() {
  if (!supabaseClient || !currentUser) return;
  const payload = {
    user_id: currentUser.id,
    state_json: state,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabaseClient.from("erp_state").upsert(payload, { onConflict: "user_id" });
  if (error) console.error(error);
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
  if (!data?.state_json) return false;
  Object.assign(state, normalizeStateShape(data.state_json));
  return true;
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    if (isCloudMode) await saveCloudState();
    else saveLocalState();
  }, 350);
}

function badge(type, text) {
  return `<span class="badge ${type}">${text}</span>`;
}

function statusBadge(status) {
  const s = String(status || "").toUpperCase();
  if (["APPROVED", "PASS", "PASSED", "ACTIVE", "CLEARED", "COMPLETED", "OPEN"].includes(s)) return badge("ok", status);
  if (["HOLD", "PENDING", "IN_REVIEW"].includes(s)) return badge("warn", status);
  if (["FAILED", "REJECTED", "BLOCKED"].includes(s)) return badge("danger", status);
  return badge("neutral", status || "NA");
}

function moduleLabel(key) {
  return MODULES.find(m => m.key === key)?.label || key;
}

function navigate(moduleKey, page) {
  state.ui.activeModule = moduleKey;
  state.ui.activePage = page;
  renderAll();
}

function generateDocument(docType, referenceType, referenceId) {
  const doc = {
    id: id("DOC"),
    type: docType,
    referenceType,
    referenceId,
    generatedAt: now(),
    hash: Math.random().toString(16).slice(2, 14)
  };
  state.documents.unshift(doc);
  audit("DOCUMENT_GENERATED", "document", doc.id, null, doc);
}

function pdfEscape(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfText(text, maxChars) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function buildWorkOrderPdfBlob(workOrder) {
  const header = "%PDF-1.4\n";
  const c = [];
  const left = 34;
  const width = 595 - (left * 2);
  let y = 806;

  const text = (val, x, yy, size = 10, bold = false) => c.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${yy} Tm (${pdfEscape(val)}) Tj ET`);
  const line = (x1, y1, x2, y2, w = 0.8) => c.push(`${w} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (x, yy, w, h, bw = 0.8) => c.push(`${bw} w ${x} ${yy} ${w} ${h} re S`);

  rect(left, 34, width, 774, 1.1);
  rect(left, y - 40, width, 40, 1.1);
  text("SAMPLE WORK ORDER STANDARD TEMPLATE / V1", left + 10, y - 24, 13, true);
  text("WORK ORDER", left + width - 110, y - 24, 12, true);
  y -= 58;

  text(`Date: ${workOrder.date}`, left + 10, y, 10);
  text(`Document No: ${workOrder.documentNo}`, left + 165, y, 10);
  text("Team: CEO + PPC", left + width - 110, y, 10);
  y -= 15;
  line(left, y, left + width, y, 1);
  y -= 16;

  text("Primary Information", left + 10, y, 11, true);
  y -= 10;
  rect(left + 8, y - 126, width - 16, 126, 0.8);
  line(left + 45, y, left + 45, y - 126, 0.7);
  line(left + 250, y, left + 250, y - 126, 0.7);
  line(left + width - 76, y, left + width - 76, y - 126, 0.7);

  const rows = [
    ["1", "Sample Work Order No. & Date", `${workOrder.workOrderNo} / ${workOrder.date}`, "PPC F1"],
    ["2", "Client Name", workOrder.clientName, ""],
    ["3", "Enquiry Promoter", workOrder.enquiryPromoter, ""],
    ["4", "Dispatch Due Date", workOrder.dispatchDueDate, ""],
    ["5", "Enquiry Type", workOrder.enquiryType, ""],
    ["6", "Courier Name", workOrder.courierName, ""]
  ];
  const rowTop = y - 16;
  const h = 18;
  text("No", left + 14, y - 11, 9, true);
  text("Particular", left + 54, y - 11, 9, true);
  text("Details", left + 258, y - 11, 9, true);
  text("Remark", left + width - 68, y - 11, 9, true);
  for (let i = 0; i <= rows.length; i++) line(left + 8, rowTop - (i * h), left + width - 8, rowTop - (i * h), 0.6);
  rows.forEach((r, i) => {
    const yy = rowTop - (i * h) - 13;
    text(r[0], left + 14, yy, 9);
    text(r[1], left + 54, yy, 9);
    text(r[2], left + 258, yy, 9);
    text(r[3], left + width - 68, yy, 9);
  });

  y -= 142;
  text("Product Details", left + 10, y, 11, true);
  y -= 10;
  rect(left + 8, y - 56, width - 16, 56, 0.8);
  line(left + 40, y, left + 40, y - 56, 0.6);
  line(left + 290, y, left + 290, y - 56, 0.6);
  line(left + 405, y, left + 405, y - 56, 0.6);
  line(left + 8, y - 20, left + width - 8, y - 20, 0.6);
  text("Sr", left + 14, y - 12, 9, true);
  text("Name of the Product", left + 50, y - 12, 9, true);
  text("Quantity In gm", left + 300, y - 12, 9, true);
  text("HSN/SAC", left + 415, y - 12, 9, true);
  text("1", left + 14, y - 37, 9);
  text(workOrder.productName, left + 50, y - 37, 9);
  text(String(workOrder.quantityGm), left + 300, y - 37, 9);
  text(workOrder.hsnSac, left + 415, y - 37, 9);

  y -= 72;
  text("Specification Details", left + 10, y, 11, true);
  y -= 10;
  rect(left + 8, y - 100, width - 16, 100, 0.8);
  line(left + 40, y, left + 40, y - 100, 0.6);
  line(left + 220, y, left + 220, y - 100, 0.6);
  for (let i = 1; i <= 4; i++) line(left + 8, y - (i * 25), left + width - 8, y - (i * 25), 0.6);

  const specs = [
    ["1", "Product Size", workOrder.productSize],
    ["2", "Specific Requirements", workOrder.specificRequirements],
    ["3", "Type of Packaging", workOrder.packagingType],
    ["4", "Reference Sample", workOrder.referenceSample]
  ];
  specs.forEach((s, i) => {
    const yy = y - (i * 25) - 16;
    text(s[0], left + 14, yy, 9);
    text(s[1], left + 48, yy, 9);
    wrapPdfText(s[2], 56).slice(0, 2).forEach((w, idx) => text(w, left + 228, yy - (idx * 10), 9));
  });

  y -= 114;
  text("Dispatch Details", left + 10, y, 11, true);
  y -= 10;
  rect(left + 8, y - 74, width - 16, 74, 0.8);
  line(left + 172, y, left + 172, y - 74, 0.6);
  line(left + 336, y, left + 336, y - 74, 0.6);
  for (let i = 1; i <= 3; i++) line(left + 8, y - (i * 24), left + width - 8, y - (i * 24), 0.6);

  text("Concern Person", left + 12, y - 16, 9, true);
  text(workOrder.concernPerson, left + 178, y - 16, 9);
  text("Courier/Transporter", left + 342, y - 16, 9, true);
  text(workOrder.courierTransporterDetails, left + 342, y - 27, 8.5);
  text("Delivery At", left + 12, y - 40, 9, true);
  wrapPdfText(workOrder.deliveryAt, 35).slice(0, 2).forEach((w, idx) => text(w, left + 178, y - 40 - (idx * 10), 9));

  y -= 92;
  line(left + 8, y, left + width - 8, y, 1);
  text("Prepared by: Admin Manager", left + 14, y - 16, 9.5);
  text("Verified by: PPC in charge", left + 206, y - 16, 9.5);
  text("Authorized by: CEO", left + 414, y - 16, 9.5);

  const content = c.join("\n");
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n"
  ];

  let body = "";
  const offsets = [0];
  for (const o of objs) {
    offsets.push((header + body).length);
    body += o;
  }

  const xrefStart = (header + body).length;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Blob([header, body, xref, trailer], { type: "application/pdf" });
}

function createWorkOrderFromQuotation(quotation, enquiry) {
  const wo = {
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
    specificRequirements: "As per quotation / customer standards",
    packagingType: "Standard export packing",
    referenceSample: "Approved reference sample",
    concernPerson: quotation.customer,
    deliveryAt: "Customer dispatch address",
    courierTransporterDetails: "Pending transporter allocation"
  };
  state.workOrders.unshift(wo);
  audit("CREATE", "work_order", wo.id, null, wo);
  generateDocument("Work Order", "quotation", quotation.id);
}

function downloadWorkOrderPdf(quotationId) {
  const wo = state.workOrders.find(w => w.quotationId === quotationId);
  if (!wo) return;
  const pdf = buildWorkOrderPdfBlob(wo);
  const url = URL.createObjectURL(pdf);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${wo.workOrderNo}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  audit("EXPORT", "work_order", wo.id, null, { format: "pdf" });
}

function seed() {
  resetState();

  state.appUsers = [
    {
      id: id("USR"),
      name: "Primary Admin",
      email: "admin@factory.com",
      role: "Super Admin",
      permissions: defaultPermissionsForRole("Super Admin"),
      status: "ACTIVE"
    },
    {
      id: id("USR"),
      name: "Sales Lead",
      email: "sales@factory.com",
      role: "Sales Manager",
      permissions: defaultPermissionsForRole("Sales Manager"),
      status: "ACTIVE"
    }
  ];

  state.products = [
    { id: id("PRD"), sku: "ONION-001", name: "Dehydrated Onion Flakes", uom: "kg", status: "ACTIVE" },
    { id: id("PRD"), sku: "GARLIC-001", name: "Dehydrated Garlic Powder", uom: "kg", status: "ACTIVE" }
  ];
  state.customers = [
    { id: id("CUS"), name: "SunDry Foods", currency: "INR", status: "ACTIVE" },
    { id: id("CUS"), name: "AgriNova Exports", currency: "USD", status: "ACTIVE" }
  ];
  state.vendors = [
    { id: id("VND"), name: "FreshFarm Inputs", rating: 4.2, status: "ACTIVE" },
    { id: id("VND"), name: "HarvestLink", rating: 3.9, status: "ACTIVE" }
  ];
  state.enquiries = [
    { id: "ENQ-1001", customer: "SunDry Foods", product: "Dehydrated Onion Flakes", qty: 5000, deliveryDate: "2026-03-02", aiScore: 81, status: "OPEN" },
    { id: "ENQ-1002", customer: "AgriNova Exports", product: "Dehydrated Garlic Powder", qty: 3200, deliveryDate: "2026-02-27", aiScore: 73, status: "FOLLOWUP" }
  ];
  state.purchaseRequisitions = [
    { id: id("PRQ"), material: "Raw Onion", qty: 12000, requiredBy: "2026-02-22", status: "PENDING" }
  ];
  state.dispatchOrders = [
    { id: id("DSP"), customer: "SunDry Foods", vehicle: "Pending", eta: "2026-03-03", status: "OPEN" }
  ];

  const first = firstAccessibleModuleAndPage();
  state.ui.activeModule = first.module.key;
  state.ui.activePage = first.page;

  notify("System Ready", "Modern module-based ERP initialized", "neutral");
  audit("SEED", "system", "seed", null, { ok: true });
}

function createEnquiry(formData) {
  const e = {
    id: id("ENQ"),
    customer: formData.customer,
    product: formData.product,
    qty: Number(formData.qty),
    deliveryDate: formData.deliveryDate,
    aiScore: Number(formData.aiScore || 70),
    status: "OPEN"
  };
  state.enquiries.unshift(e);
  audit("CREATE", "enquiry", e.id, null, e);
  notify("Enquiry Added", `${e.id} created`, "neutral");
  renderAll();
}

function createQuotationFromEnquiry(enquiryId) {
  const enq = state.enquiries.find(x => x.id === enquiryId);
  if (!enq) return;
  const q = {
    id: id("QUO"),
    enquiryId,
    customer: enq.customer,
    product: enq.product,
    qty: enq.qty,
    margin: Math.floor(Math.random() * 15) + 6,
    status: "PENDING",
    expiresOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  };
  if (q.margin >= 10) q.status = "APPROVED";
  state.quotations.unshift(q);
  enq.status = "QUOTED";
  createWorkOrderFromQuotation(q, enq);
  generateDocument("Quotation", "quotation", q.id);
  audit("CREATE", "quotation", q.id, null, q);
  notify("Quotation Created", `${q.id} created`, q.status === "APPROVED" ? "neutral" : "warn");
  renderAll();
}

function approveQuotation(qId) {
  const q = state.quotations.find(x => x.id === qId);
  if (!q) return;
  const old = clone(q);
  q.status = "APPROVED";
  audit("APPROVE", "quotation", q.id, old, q);
  renderAll();
}

function createSalesOrder(qId) {
  const q = state.quotations.find(x => x.id === qId && x.status === "APPROVED");
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
  notify("Sales Order", `${so.id} created`, "neutral");
  renderAll();
}

function addPurchaseReq(formData) {
  const pr = {
    id: id("PRQ"),
    material: formData.material,
    qty: Number(formData.qty),
    requiredBy: formData.requiredBy,
    status: "PENDING"
  };
  state.purchaseRequisitions.unshift(pr);
  audit("CREATE", "purchase_requisition", pr.id, null, pr);
  renderAll();
}

function addVendor(formData) {
  const v = { id: id("VND"), name: formData.name, rating: Number(formData.rating || 4), status: "ACTIVE" };
  state.vendors.unshift(v);
  audit("CREATE", "vendor", v.id, null, v);
  renderAll();
}

function addGRN(formData) {
  const g = {
    id: id("GRN"),
    vendor: formData.vendor,
    material: formData.material,
    batchTag: formData.batchTag,
    status: formData.qcHold ? "HOLD" : "RELEASED"
  };
  state.grn.unshift(g);
  audit("CREATE", "grn", g.id, null, g);
  renderAll();
}

function addProduct(formData) {
  const p = { id: id("PRD"), sku: formData.sku, name: formData.name, uom: formData.uom || "kg", status: "ACTIVE" };
  state.products.unshift(p);
  audit("CREATE", "product", p.id, null, p);
  renderAll();
}

function addCustomer(formData) {
  const c = { id: id("CUS"), name: formData.name, currency: formData.currency || "INR", status: "ACTIVE" };
  state.customers.unshift(c);
  audit("CREATE", "customer", c.id, null, c);
  renderAll();
}

function addBOM(formData) {
  const b = { id: id("BOM"), product: formData.product, version: Number(formData.version || 1), status: "ACTIVE" };
  state.bom.unshift(b);
  audit("CREATE", "bom", b.id, null, b);
  renderAll();
}

function addPreProcessing(formData) {
  const r = { id: id("PRE"), batch: formData.batch, stage: "Batch Intake", inputQty: Number(formData.inputQty), status: "OPEN" };
  state.preProcessing.unshift(r);
  audit("CREATE", "pre_processing", r.id, null, r);
  renderAll();
}

function addWashSort(formData) {
  const r = { id: id("WS"), batch: formData.batch, sortedQty: Number(formData.sortedQty), rejectedQty: Number(formData.rejectedQty), status: "COMPLETED" };
  state.washSort.unshift(r);
  audit("CREATE", "wash_sort", r.id, null, r);
  renderAll();
}

function addQC(formData) {
  const qc = {
    id: id("QC"),
    batch: formData.batch,
    moisture: Number(formData.moisture),
    color: formData.color,
    status: formData.status
  };
  state.qcReports.unshift(qc);
  audit("CREATE", "qc", qc.id, null, qc);
  if (qc.status === "FAILED") {
    const n = { id: id("NCR"), qcId: qc.id, rootCause: "Parameter out of range", status: "OPEN" };
    state.ncr.unshift(n);
    audit("CREATE", "ncr", n.id, null, n);
  }
  renderAll();
}

function addJobCard(formData) {
  const j = { id: id("JOB"), batch: formData.batch, machine: formData.machine, inputQty: Number(formData.inputQty), outputQty: Number(formData.outputQty), status: "OPEN" };
  state.jobCards.unshift(j);
  audit("CREATE", "job_card", j.id, null, j);
  renderAll();
}

function addMachineLog(formData) {
  const m = { id: id("MLOG"), machine: formData.machine, downtimeMins: Number(formData.downtimeMins), reason: formData.reason, status: "RECORDED" };
  state.machineLogs.unshift(m);
  audit("CREATE", "machine_log", m.id, null, m);
  renderAll();
}

function addInvoice(formData) {
  const i = { id: id("INV"), customer: formData.customer, amount: Number(formData.amount), dueDate: formData.dueDate, status: "OPEN" };
  state.invoices.unshift(i);
  audit("CREATE", "invoice", i.id, null, i);
  generateDocument("Invoice", "invoice", i.id);
  renderAll();
}

function addPayment(formData) {
  const p = { id: id("PAY"), invoiceId: formData.invoiceId, amount: Number(formData.amount), mode: formData.mode, status: "POSTED" };
  state.payments.unshift(p);
  audit("CREATE", "payment", p.id, null, p);
  renderAll();
}

function addPackingSlip(formData) {
  const p = { id: id("PKG"), batch: formData.batch, customer: formData.customer, weight: Number(formData.weight), status: "READY" };
  state.packingSlips.unshift(p);
  audit("CREATE", "packing_slip", p.id, null, p);
  generateDocument("Packing Slip", "packing_slip", p.id);
  renderAll();
}

function addLabel(formData) {
  const l = { id: id("LBL"), batch: formData.batch, spec: formData.spec, status: "GENERATED" };
  state.labels.unshift(l);
  audit("CREATE", "label", l.id, null, l);
  renderAll();
}

function addDispatch(formData) {
  const d = { id: id("DSP"), customer: formData.customer, vehicle: formData.vehicle, eta: formData.eta, status: "OPEN" };
  state.dispatchOrders.unshift(d);
  audit("CREATE", "dispatch", d.id, null, d);
  renderAll();
}

function addTracking(formData) {
  const d = state.dispatchOrders.find(x => x.id === formData.dispatchId);
  if (!d) return;
  const old = clone(d);
  d.status = formData.status;
  d.trackingNote = formData.note;
  audit("UPDATE", "dispatch", d.id, old, d);
  renderAll();
}

function addAppUser(formData) {
  const role = formData.role;
  const user = {
    id: id("USR"),
    name: formData.name,
    email: formData.email,
    role,
    permissions: defaultPermissionsForRole(role),
    status: "ACTIVE"
  };
  state.appUsers.unshift(user);
  audit("CREATE", "user", user.id, null, user);
  renderAll();
}

function updateUserRole(userId, role) {
  const user = state.appUsers.find(u => u.id === userId);
  if (!user) return;
  const old = clone(user);
  user.role = role;
  user.permissions = defaultPermissionsForRole(role);
  audit("UPDATE", "user", user.id, old, user);
  renderAll();
}

function toggleModuleAccess(userId, moduleKey, enabled) {
  const user = state.appUsers.find(u => u.id === userId);
  if (!user) return;
  const old = clone(user.permissions[moduleKey]);
  user.permissions[moduleKey].enabled = enabled;
  const module = MODULES.find(m => m.key === moduleKey);
  if (!enabled) {
    for (const p of module.pages) user.permissions[moduleKey].pages[p] = false;
  }
  audit("UPDATE", "permission_module", `${user.id}:${moduleKey}`, old, user.permissions[moduleKey]);
  renderAll();
}

function togglePageAccess(userId, moduleKey, page, enabled) {
  const user = state.appUsers.find(u => u.id === userId);
  if (!user) return;
  const old = user.permissions[moduleKey].pages[page];
  user.permissions[moduleKey].enabled = true;
  user.permissions[moduleKey].pages[page] = enabled;
  audit("UPDATE", "permission_page", `${user.id}:${moduleKey}:${page}`, old, enabled);
  renderAll();
}

function kpiCardsHtml() {
  const pendingApprovals = state.quotations.filter(q => q.status === "PENDING").length;
  const qcFailures = state.qcReports.filter(q => q.status === "FAILED").length;
  const openInvoices = state.invoices.filter(i => i.status === "OPEN").length;
  const openDispatch = state.dispatchOrders.filter(d => d.status !== "DELIVERED").length;

  return `
    <div class="kpi-grid">
      <div class="card kpi-card"><div class="muted">Pending Approvals</div><div class="kpi-value">${pendingApprovals}</div></div>
      <div class="card kpi-card"><div class="muted">QC Failures</div><div class="kpi-value">${qcFailures}</div></div>
      <div class="card kpi-card"><div class="muted">Open Invoices</div><div class="kpi-value">${openInvoices}</div></div>
      <div class="card kpi-card"><div class="muted">Dispatch In-Flight</div><div class="kpi-value">${openDispatch}</div></div>
    </div>
  `;
}

function analyticsPanelHtml() {
  const totalSales = state.invoices.reduce((a, x) => a + Number(x.amount || 0), 0);
  const totalCollections = state.payments.reduce((a, x) => a + Number(x.amount || 0), 0);
  const yieldRatio = state.jobCards.length
    ? Math.round((state.jobCards.reduce((a, x) => a + Number(x.outputQty || 0), 0) / Math.max(1, state.jobCards.reduce((a, x) => a + Number(x.inputQty || 0), 0))) * 100)
    : 0;

  const bars = [
    { label: "Sales Pipeline", value: Math.min(100, state.enquiries.length * 12) },
    { label: "Production Throughput", value: Math.min(100, state.jobCards.length * 15) },
    { label: "Quality Health", value: Math.max(0, 100 - (state.ncr.length * 8)) },
    { label: "Dispatch Efficiency", value: Math.min(100, state.dispatchOrders.length * 10) }
  ];

  return `
    <div class="card panel">
      <h3>Analytics</h3>
      <div class="grid-3">
        <div><div class="muted tiny">Sales Billed</div><div class="kpi-value">${totalSales.toFixed(0)}</div></div>
        <div><div class="muted tiny">Collections</div><div class="kpi-value">${totalCollections.toFixed(0)}</div></div>
        <div><div class="muted tiny">Yield %</div><div class="kpi-value">${yieldRatio}%</div></div>
      </div>
      <div class="stack gap-sm" style="margin-top:12px;">
        ${bars.map(b => `<div><div class="row" style="justify-content:space-between;"><span>${b.label}</span><span class="muted tiny">${b.value}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${b.value}%"></div></div></div>`).join("")}
      </div>
    </div>
  `;
}

function moduleTabsHtml(module) {
  const accessiblePages = module.pages.filter(p => canAccess(module.key, p));
  return `
    <div class="tabs">
      ${accessiblePages.map(p => `<button class="tab-btn ${state.ui.activePage === p ? "active" : ""}" onclick="navigate('${module.key}','${p}')">${p}</button>`).join("")}
    </div>
  `;
}

function salesPageHtml(page) {
  if (page === "Enquiries") {
    return `
      <div class="card panel">
        <h3>Create Enquiry</h3>
        <form id="enquiryForm" class="grid-4">
          <input name="customer" placeholder="Customer" required />
          <input name="product" placeholder="Product" required />
          <input name="qty" type="number" placeholder="Quantity" required />
          <input name="deliveryDate" type="date" required />
          <input name="aiScore" type="number" placeholder="AI Score" value="75" required />
          <button class="btn btn-primary" type="submit">Create Enquiry</button>
        </form>
      </div>
      <div class="card panel table-wrap">
        <h3>Enquiries</h3>
        <table><thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Qty</th><th>Delivery</th><th>AI</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          ${state.enquiries.map(e => `<tr><td>${e.id}</td><td>${e.customer}</td><td>${e.product}</td><td>${e.qty}</td><td>${e.deliveryDate}</td><td>${e.aiScore}</td><td>${statusBadge(e.status)}</td><td class="actions"><button class="btn" onclick="createQuotationFromEnquiry('${e.id}')">Create Quotation</button></td></tr>`).join("")}
        </tbody></table>
      </div>
    `;
  }

  if (page === "Quotations") {
    return `
      <div class="card panel table-wrap">
        <h3>Quotations</h3>
        <table><thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Qty</th><th>Margin%</th><th>Status</th><th>Expires</th><th>Work Order</th><th>Actions</th></tr></thead><tbody>
          ${state.quotations.map(q => `<tr>
            <td>${q.id}</td><td>${q.customer}</td><td>${q.product}</td><td>${q.qty}</td><td>${q.margin}</td><td>${statusBadge(q.status)}</td><td>${q.expiresOn}</td>
            <td>${state.workOrders.some(w => w.quotationId === q.id) ? `<button class="btn" onclick="downloadWorkOrderPdf('${q.id}')">Download PDF</button>` : "-"}</td>
            <td class="actions">
              ${q.status === "PENDING" ? `<button class="btn" onclick="approveQuotation('${q.id}')">Approve</button>` : ""}
              ${q.status === "APPROVED" ? `<button class="btn btn-primary" onclick="createSalesOrder('${q.id}')">Create SO</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody></table>
      </div>
    `;
  }

  return `
    <div class="card panel table-wrap">
      <h3>Sales Orders</h3>
      <table><thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Qty</th><th>Credit</th><th>Status</th></tr></thead><tbody>
        ${state.salesOrders.map(so => `<tr><td>${so.id}</td><td>${so.customer}</td><td>${so.product}</td><td>${so.qty}</td><td>${statusBadge(so.creditStatus)}</td><td>${statusBadge(so.status)}</td></tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function purchasePageHtml(page) {
  if (page === "Requisitions") {
    return `
      <div class="card panel">
        <h3>Create Purchase Requisition</h3>
        <form id="purchaseReqForm" class="grid-4">
          <input name="material" placeholder="Material" required />
          <input name="qty" type="number" placeholder="Quantity" required />
          <input name="requiredBy" type="date" required />
          <button class="btn btn-primary" type="submit">Create PR</button>
        </form>
      </div>
      <div class="card panel table-wrap">
        <table><thead><tr><th>ID</th><th>Material</th><th>Qty</th><th>Required By</th><th>Status</th></tr></thead><tbody>
          ${state.purchaseRequisitions.map(r => `<tr><td>${r.id}</td><td>${r.material}</td><td>${r.qty}</td><td>${r.requiredBy}</td><td>${statusBadge(r.status)}</td></tr>`).join("")}
        </tbody></table>
      </div>
    `;
  }

  if (page === "Vendors") {
    return `
      <div class="card panel">
        <h3>Add Vendor</h3>
        <form id="vendorForm" class="grid-4">
          <input name="name" placeholder="Vendor Name" required />
          <input name="rating" type="number" step="0.1" min="1" max="5" placeholder="Rating" />
          <button class="btn btn-primary" type="submit">Add Vendor</button>
        </form>
      </div>
      <div class="card panel table-wrap">
        <table><thead><tr><th>ID</th><th>Name</th><th>Rating</th><th>Status</th></tr></thead><tbody>
          ${state.vendors.map(v => `<tr><td>${v.id}</td><td>${v.name}</td><td>${v.rating}</td><td>${statusBadge(v.status)}</td></tr>`).join("")}
        </tbody></table>
      </div>
    `;
  }

  return `
    <div class="card panel">
      <h3>Create GRN</h3>
      <form id="grnForm" class="grid-4">
        <input name="vendor" placeholder="Vendor" required />
        <input name="material" placeholder="Material" required />
        <input name="batchTag" placeholder="Batch Tag" required />
        <label><input type="checkbox" name="qcHold" /> QC Hold</label>
        <button class="btn btn-primary" type="submit">Post GRN</button>
      </form>
    </div>
    <div class="card panel table-wrap">
      <table><thead><tr><th>ID</th><th>Vendor</th><th>Material</th><th>Batch</th><th>Status</th></tr></thead><tbody>
        ${state.grn.map(g => `<tr><td>${g.id}</td><td>${g.vendor}</td><td>${g.material}</td><td>${g.batchTag}</td><td>${statusBadge(g.status)}</td></tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function masterDataPageHtml(page) {
  if (page === "Products") {
    return `
      <div class="card panel"><h3>Add Product</h3><form id="productForm" class="grid-4">
        <input name="sku" placeholder="SKU" required />
        <input name="name" placeholder="Product Name" required />
        <input name="uom" placeholder="UOM" value="kg" />
        <button class="btn btn-primary" type="submit">Add Product</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>SKU</th><th>Name</th><th>UOM</th><th>Status</th></tr></thead><tbody>
        ${state.products.map(p => `<tr><td>${p.sku}</td><td>${p.name}</td><td>${p.uom}</td><td>${statusBadge(p.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  if (page === "Customers") {
    return `
      <div class="card panel"><h3>Add Customer</h3><form id="customerForm" class="grid-4">
        <input name="name" placeholder="Customer Name" required />
        <input name="currency" placeholder="Currency" value="INR" />
        <button class="btn btn-primary" type="submit">Add Customer</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Currency</th><th>Status</th></tr></thead><tbody>
        ${state.customers.map(c => `<tr><td>${c.id}</td><td>${c.name}</td><td>${c.currency}</td><td>${statusBadge(c.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  return `
    <div class="card panel"><h3>Add BOM</h3><form id="bomForm" class="grid-4">
      <input name="product" placeholder="Product" required />
      <input name="version" type="number" placeholder="Version" value="1" required />
      <button class="btn btn-primary" type="submit">Add BOM</button>
    </form></div>
    <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Product</th><th>Version</th><th>Status</th></tr></thead><tbody>
      ${state.bom.map(b => `<tr><td>${b.id}</td><td>${b.product}</td><td>${b.version}</td><td>${statusBadge(b.status)}</td></tr>`).join("")}
    </tbody></table></div>
  `;
}

function preProcessingPageHtml(page) {
  if (page === "Batch Intake") {
    return `
      <div class="card panel"><h3>Batch Intake</h3><form id="preForm" class="grid-4">
        <input name="batch" placeholder="Batch" required />
        <input name="inputQty" type="number" placeholder="Input Qty" required />
        <button class="btn btn-primary" type="submit">Record Intake</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Batch</th><th>Input Qty</th><th>Status</th></tr></thead><tbody>
        ${state.preProcessing.map(x => `<tr><td>${x.id}</td><td>${x.batch}</td><td>${x.inputQty}</td><td>${statusBadge(x.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  return `
    <div class="card panel"><h3>Wash & Sort</h3><form id="washSortForm" class="grid-4">
      <input name="batch" placeholder="Batch" required />
      <input name="sortedQty" type="number" placeholder="Sorted Qty" required />
      <input name="rejectedQty" type="number" placeholder="Rejected Qty" required />
      <button class="btn btn-primary" type="submit">Record Stage</button>
    </form></div>
    <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Batch</th><th>Sorted</th><th>Rejected</th><th>Status</th></tr></thead><tbody>
      ${state.washSort.map(x => `<tr><td>${x.id}</td><td>${x.batch}</td><td>${x.sortedQty}</td><td>${x.rejectedQty}</td><td>${statusBadge(x.status)}</td></tr>`).join("")}
    </tbody></table></div>
  `;
}

function inspectionPageHtml(page) {
  if (page === "QC Entry") {
    return `
      <div class="card panel"><h3>QC Entry</h3><form id="qcForm" class="grid-4">
        <input name="batch" placeholder="Batch" required />
        <input name="moisture" type="number" step="0.01" placeholder="Moisture %" required />
        <input name="color" placeholder="Color" required />
        <select name="status"><option value="PASSED">PASSED</option><option value="FAILED">FAILED</option></select>
        <button class="btn btn-primary" type="submit">Submit QC</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Batch</th><th>Moisture</th><th>Color</th><th>Status</th></tr></thead><tbody>
        ${state.qcReports.map(q => `<tr><td>${q.id}</td><td>${q.batch}</td><td>${q.moisture}</td><td>${q.color}</td><td>${statusBadge(q.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  return `
    <div class="card panel table-wrap"><h3>NCR</h3>
      <table><thead><tr><th>ID</th><th>QC ID</th><th>Root Cause</th><th>Status</th></tr></thead><tbody>
        ${state.ncr.map(n => `<tr><td>${n.id}</td><td>${n.qcId}</td><td>${n.rootCause}</td><td>${statusBadge(n.status)}</td></tr>`).join("")}
      </tbody></table>
    </div>
  `;
}

function sizeReductionPageHtml(page) {
  if (page === "Job Cards") {
    return `
      <div class="card panel"><h3>Job Card Entry</h3><form id="jobCardForm" class="grid-4">
        <input name="batch" placeholder="Batch" required />
        <input name="machine" placeholder="Machine" required />
        <input name="inputQty" type="number" placeholder="Input Qty" required />
        <input name="outputQty" type="number" placeholder="Output Qty" required />
        <button class="btn btn-primary" type="submit">Create Job Card</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Batch</th><th>Machine</th><th>Input</th><th>Output</th><th>Status</th></tr></thead><tbody>
        ${state.jobCards.map(j => `<tr><td>${j.id}</td><td>${j.batch}</td><td>${j.machine}</td><td>${j.inputQty}</td><td>${j.outputQty}</td><td>${statusBadge(j.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  return `
    <div class="card panel"><h3>Machine Downtime Log</h3><form id="machineLogForm" class="grid-4">
      <input name="machine" placeholder="Machine" required />
      <input name="downtimeMins" type="number" placeholder="Downtime (mins)" required />
      <input name="reason" placeholder="Reason" required />
      <button class="btn btn-primary" type="submit">Add Log</button>
    </form></div>
    <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Machine</th><th>Downtime</th><th>Reason</th><th>Status</th></tr></thead><tbody>
      ${state.machineLogs.map(m => `<tr><td>${m.id}</td><td>${m.machine}</td><td>${m.downtimeMins}</td><td>${m.reason}</td><td>${statusBadge(m.status)}</td></tr>`).join("")}
    </tbody></table></div>
  `;
}

function invoicingPageHtml(page) {
  if (page === "Invoices") {
    return `
      <div class="card panel"><h3>Create Invoice</h3><form id="invoiceForm" class="grid-4">
        <input name="customer" placeholder="Customer" required />
        <input name="amount" type="number" placeholder="Amount" required />
        <input name="dueDate" type="date" required />
        <button class="btn btn-primary" type="submit">Create Invoice</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Status</th></tr></thead><tbody>
        ${state.invoices.map(i => `<tr><td>${i.id}</td><td>${i.customer}</td><td>${i.amount}</td><td>${i.dueDate}</td><td>${statusBadge(i.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  return `
    <div class="card panel"><h3>Post Payment</h3><form id="paymentForm" class="grid-4">
      <input name="invoiceId" placeholder="Invoice ID" required />
      <input name="amount" type="number" placeholder="Amount" required />
      <input name="mode" placeholder="Mode" value="Bank Transfer" required />
      <button class="btn btn-primary" type="submit">Post Payment</button>
    </form></div>
    <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Invoice ID</th><th>Amount</th><th>Mode</th><th>Status</th></tr></thead><tbody>
      ${state.payments.map(p => `<tr><td>${p.id}</td><td>${p.invoiceId}</td><td>${p.amount}</td><td>${p.mode}</td><td>${statusBadge(p.status)}</td></tr>`).join("")}
    </tbody></table></div>
  `;
}

function packagingPageHtml(page) {
  if (page === "Packing Slips") {
    return `
      <div class="card panel"><h3>Create Packing Slip</h3><form id="packingSlipForm" class="grid-4">
        <input name="batch" placeholder="Batch" required />
        <input name="customer" placeholder="Customer" required />
        <input name="weight" type="number" placeholder="Weight" required />
        <button class="btn btn-primary" type="submit">Create Slip</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Batch</th><th>Customer</th><th>Weight</th><th>Status</th></tr></thead><tbody>
        ${state.packingSlips.map(p => `<tr><td>${p.id}</td><td>${p.batch}</td><td>${p.customer}</td><td>${p.weight}</td><td>${statusBadge(p.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  return `
    <div class="card panel"><h3>Create Label</h3><form id="labelForm" class="grid-4">
      <input name="batch" placeholder="Batch" required />
      <input name="spec" placeholder="Label Spec" required />
      <button class="btn btn-primary" type="submit">Generate Label</button>
    </form></div>
    <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Batch</th><th>Spec</th><th>Status</th></tr></thead><tbody>
      ${state.labels.map(l => `<tr><td>${l.id}</td><td>${l.batch}</td><td>${l.spec}</td><td>${statusBadge(l.status)}</td></tr>`).join("")}
    </tbody></table></div>
  `;
}

function dispatchPageHtml(page) {
  if (page === "Dispatch Orders") {
    return `
      <div class="card panel"><h3>Create Dispatch Order</h3><form id="dispatchForm" class="grid-4">
        <input name="customer" placeholder="Customer" required />
        <input name="vehicle" placeholder="Vehicle" required />
        <input name="eta" type="date" required />
        <button class="btn btn-primary" type="submit">Create Dispatch</button>
      </form></div>
      <div class="card panel table-wrap"><table><thead><tr><th>ID</th><th>Customer</th><th>Vehicle</th><th>ETA</th><th>Status</th></tr></thead><tbody>
        ${state.dispatchOrders.map(d => `<tr><td>${d.id}</td><td>${d.customer}</td><td>${d.vehicle}</td><td>${d.eta}</td><td>${statusBadge(d.status)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }

  return `
    <div class="card panel"><h3>Dispatch Tracking Update</h3><form id="trackingForm" class="grid-4">
      <input name="dispatchId" placeholder="Dispatch ID" required />
      <select name="status"><option>OPEN</option><option>IN_TRANSIT</option><option>DELIVERED</option></select>
      <input name="note" placeholder="Tracking Note" required />
      <button class="btn btn-primary" type="submit">Update Tracking</button>
    </form></div>
  `;
}

function superAdminPageHtml(page) {
  if (page === "Dashboard") {
    return `
      ${kpiCardsHtml()}
      ${analyticsPanelHtml()}
      <div class="card panel table-wrap">
        <h3>Recent Notifications</h3>
        <table><thead><tr><th>Time</th><th>Title</th><th>Body</th><th>Severity</th></tr></thead><tbody>
          ${state.notifications.slice(0, 8).map(n => `<tr><td>${n.at}</td><td>${n.title}</td><td>${n.body}</td><td>${statusBadge(n.severity.toUpperCase())}</td></tr>`).join("")}
        </tbody></table>
      </div>
    `;
  }

  if (page === "Users") {
    const roleOptions = ["Super Admin", "Sales Manager", "Purchase Manager", "QC Manager", "Accounts Manager", "Production Supervisor", "Master Data Admin"];
    return `
      <div class="card panel">
        <h3>Add App User</h3>
        <form id="appUserForm" class="grid-4">
          <input name="name" placeholder="Full Name" required />
          <input name="email" type="email" placeholder="Email" required />
          <select name="role">${roleOptions.map(r => `<option>${r}</option>`).join("")}</select>
          <button class="btn btn-primary" type="submit">Create User</button>
        </form>
      </div>
      <div class="card panel table-wrap">
        <h3>Users</h3>
        <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Change Role</th></tr></thead><tbody>
          ${state.appUsers.map(u => `<tr>
            <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td><td>${statusBadge(u.status)}</td>
            <td>
              <select onchange="updateUserRole('${u.id}', this.value)">
                ${roleOptions.map(r => `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
              </select>
            </td>
          </tr>`).join("")}
        </tbody></table>
      </div>
    `;
  }

  if (page === "Access Control") {
    const selectedUserId = state.ui.selectedUserId || state.appUsers[0]?.id;
    state.ui.selectedUserId = selectedUserId;
    const user = state.appUsers.find(u => u.id === selectedUserId);

    return `
      <div class="card panel">
        <h3>Module & Page Access</h3>
        <div class="row gap-sm" style="margin-bottom:12px;">
          <label style="min-width:140px;">Select User</label>
          <select id="accessUserSelect" onchange="setAccessUser(this.value)">
            ${state.appUsers.map(u => `<option value="${u.id}" ${u.id === selectedUserId ? "selected" : ""}>${u.name} (${u.role})</option>`).join("")}
          </select>
        </div>
        <div class="table-wrap">
          <table><thead><tr><th>Module</th><th>Enable Module</th><th>Page-level Access</th></tr></thead><tbody>
            ${MODULES.map(m => {
              const perm = user?.permissions[m.key];
              return `<tr>
                <td><b>${m.label}</b></td>
                <td><input type="checkbox" ${perm?.enabled ? "checked" : ""} onchange="toggleModuleAccess('${user.id}','${m.key}', this.checked)" /></td>
                <td>
                  <div class="actions">
                    ${m.pages.map(p => `<label><input type="checkbox" ${perm?.pages[p] ? "checked" : ""} onchange="togglePageAccess('${user.id}','${m.key}','${p}', this.checked)" /> ${p}</label>`).join("")}
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody></table>
        </div>
      </div>
    `;
  }

  if (page === "Audit") {
    return `
      <div class="card panel table-wrap">
        <h3>Audit Logs</h3>
        <table><thead><tr><th>Time</th><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th><th>ID</th></tr></thead><tbody>
          ${state.auditLogs.map(a => `<tr><td>${a.timestamp}</td><td>${a.actor}</td><td>${a.role}</td><td>${a.action}</td><td>${a.entityType}</td><td>${a.entityId}</td></tr>`).join("")}
        </tbody></table>
      </div>
    `;
  }

  return analyticsPanelHtml();
}

function renderModulePage(moduleKey, page) {
  if (moduleKey === "super_admin") return superAdminPageHtml(page);
  if (moduleKey === "sales") return salesPageHtml(page);
  if (moduleKey === "purchase") return purchasePageHtml(page);
  if (moduleKey === "master_data") return masterDataPageHtml(page);
  if (moduleKey === "pre_processing") return preProcessingPageHtml(page);
  if (moduleKey === "inspection") return inspectionPageHtml(page);
  if (moduleKey === "size_reduction") return sizeReductionPageHtml(page);
  if (moduleKey === "invoicing") return invoicingPageHtml(page);
  if (moduleKey === "packaging") return packagingPageHtml(page);
  if (moduleKey === "dispatch") return dispatchPageHtml(page);
  return `<div class="card panel">Not implemented</div>`;
}

function bindForms() {
  const bind = (id, fn) => {
    const f = document.getElementById(id);
    if (!f) return;
    f.onsubmit = e => {
      e.preventDefault();
      fn(Object.fromEntries(new FormData(f).entries()));
      f.reset();
    };
  };

  bind("enquiryForm", createEnquiry);
  bind("purchaseReqForm", addPurchaseReq);
  bind("vendorForm", addVendor);
  bind("grnForm", addGRN);
  bind("productForm", addProduct);
  bind("customerForm", addCustomer);
  bind("bomForm", addBOM);
  bind("preForm", addPreProcessing);
  bind("washSortForm", addWashSort);
  bind("qcForm", addQC);
  bind("jobCardForm", addJobCard);
  bind("machineLogForm", addMachineLog);
  bind("invoiceForm", addInvoice);
  bind("paymentForm", addPayment);
  bind("packingSlipForm", addPackingSlip);
  bind("labelForm", addLabel);
  bind("dispatchForm", addDispatch);
  bind("trackingForm", addTracking);
  bind("appUserForm", addAppUser);
}

function renderModuleNav() {
  const user = getCurrentAppUser();
  const availableModules = MODULES.filter(m => user?.permissions[m.key]?.enabled);
  const nav = document.getElementById("moduleNav");
  nav.innerHTML = availableModules.map(m => `
    <button class="module-btn ${state.ui.activeModule === m.key ? "active" : ""}" onclick="navigate('${m.key}','${m.pages.find(p => canAccess(m.key,p)) || m.pages[0]}')">
      ${m.label}
    </button>
  `).join("");
}

function renderAll() {
  ensureCurrentUserProfile();

  const module = MODULES.find(m => m.key === state.ui.activeModule) || MODULES[0];
  if (!canAccess(module.key, state.ui.activePage)) {
    const fallback = firstAccessibleModuleAndPage();
    state.ui.activeModule = fallback.module.key;
    state.ui.activePage = fallback.page;
  }

  renderModuleNav();
  updateTopStatus();

  const activeModule = MODULES.find(m => m.key === state.ui.activeModule);
  document.getElementById("screenTitle").textContent = `${activeModule.label} • ${state.ui.activePage}`;
  document.getElementById("screenSubtitle").textContent = "Module-level and page-level access enforced by Super Admin";

  document.getElementById("dashboardMount").innerHTML = kpiCardsHtml();
  document.getElementById("moduleMount").innerHTML = `
    ${moduleTabsHtml(activeModule)}
    ${renderModulePage(activeModule.key, state.ui.activePage)}
  `;

  bindForms();
  schedulePersist();
}

function setAccessUser(userId) {
  state.ui.selectedUserId = userId;
  renderAll();
}

async function signIn() {
  if (!supabaseClient) return;
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) return setAuthMessage("Enter email and password.", true);
  setAuthMessage("Signing in...");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) setAuthMessage(error.message, true);
}

async function signUp() {
  if (!supabaseClient) return;
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) return setAuthMessage("Enter email and password.", true);
  setAuthMessage("Creating account...");
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) setAuthMessage(error.message, true);
  else setAuthMessage("Account created. Check email if confirmation is enabled.");
}

async function signOut() {
  if (!isCloudMode || !supabaseClient) return;
  await supabaseClient.auth.signOut();
}

async function initializeAppData() {
  if (isCloudMode) {
    const loaded = await loadCloudState();
    if (!loaded) seed();
  } else {
    const loaded = loadLocalState();
    if (!loaded) seed();
  }

  ensureCurrentUserProfile();
  const first = firstAccessibleModuleAndPage();
  state.ui.activeModule = first.module.key;
  state.ui.activePage = first.page;
}

async function initSupabaseAndAuth() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url || !cfg?.anonKey || !window.supabase?.createClient) {
    isCloudMode = false;
    currentUser = { email: "guest@local" };
    await initializeAppData();
    showApp();
    renderAll();
    return;
  }

  isCloudMode = true;
  supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
  const { data } = await supabaseClient.auth.getSession();
  currentUser = data?.session?.user || null;

  if (!currentUser) {
    showAuth();
    setAuthMessage("Sign in to continue.");
  } else {
    await initializeAppData();
    showApp();
    renderAll();
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    if (!currentUser) {
      showAuth();
      return;
    }
    await initializeAppData();
    showApp();
    renderAll();
  });
}

window.navigate = navigate;
window.createQuotationFromEnquiry = createQuotationFromEnquiry;
window.approveQuotation = approveQuotation;
window.createSalesOrder = createSalesOrder;
window.downloadWorkOrderPdf = downloadWorkOrderPdf;
window.updateUserRole = updateUserRole;
window.toggleModuleAccess = toggleModuleAccess;
window.togglePageAccess = togglePageAccess;
window.setAccessUser = setAccessUser;

document.getElementById("seedBtn").onclick = () => {
  seed();
  renderAll();
};
document.getElementById("signOutBtn").onclick = signOut;
document.getElementById("signInBtn").onclick = signIn;
document.getElementById("signUpBtn").onclick = signUp;

initSupabaseAndAuth();
