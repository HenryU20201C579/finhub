document.addEventListener("DOMContentLoaded", () => {
    // Current Global State
    window.currentDate = new Date(); // Starts at current month
    window.currentMode = 'month'; // 'month' | 'custom'
    window.customRange = { from: null, to: null };
    loadInitialData();
    updateMonthLabel();
    loadExpenses();

    // Month Navigation Nav
    document.getElementById('btnPrevMonth').addEventListener('click', () => {
        if (window.currentMode !== 'month') _exitCustomMode();
        window.currentDate.setMonth(window.currentDate.getMonth() - 1);
        updateMonthLabel();
        loadExpenses();
    });

    document.getElementById('btnNextMonth').addEventListener('click', () => {
        if (window.currentMode !== 'month') _exitCustomMode();
        window.currentDate.setMonth(window.currentDate.getMonth() + 1);
        updateMonthLabel();
        loadExpenses();
    });

    // Custom range popover
    function _togglePopover(show) {
        const pop = document.getElementById('customRangePopover');
        if (!pop) return;
        pop.style.display = show ? 'block' : 'none';
        if (show) {
            const errEl = document.getElementById('customRangeError');
            if (errEl) errEl.style.display = 'none';
            // Pre-cargar con los valores actuales si están en modo custom
            if (window.currentMode === 'custom' && window.customRange.from) {
                document.getElementById('customDateFrom').value = window.customRange.from;
                document.getElementById('customDateTo').value = window.customRange.to;
            } else {
                // Default: primer día del mes actual a hoy
                const y = window.currentDate.getFullYear();
                const m = String(window.currentDate.getMonth() + 1).padStart(2, '0');
                document.getElementById('customDateFrom').value = `${y}-${m}-01`;
                const today = new Date();
                document.getElementById('customDateTo').value =
                    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            }
        }
    }

    function _exitCustomMode() {
        window.currentMode = 'month';
        window.customRange = { from: null, to: null };
        document.getElementById('btnResetMonth').classList.add('d-none');
        document.querySelector('.month-navigator').classList.remove('opacity-50');
    }

    document.getElementById('btnCustomRange').addEventListener('click', () => _togglePopover(true));
    document.getElementById('currentMonthLabel').addEventListener('click', () => _togglePopover(true));
    document.getElementById('btnCancelCustomRange').addEventListener('click', () => _togglePopover(false));

    document.getElementById('btnApplyCustomRange').addEventListener('click', () => {
        const from = document.getElementById('customDateFrom').value;
        const to = document.getElementById('customDateTo').value;
        const errEl = document.getElementById('customRangeError');
        if (!from || !to) {
            errEl.textContent = 'Selecciona ambas fechas.';
            errEl.style.display = 'block';
            return;
        }
        if (from > to) {
            errEl.textContent = 'La fecha "Desde" no puede ser mayor que "Hasta".';
            errEl.style.display = 'block';
            return;
        }
        errEl.style.display = 'none';
        window.currentMode = 'custom';
        window.customRange = { from, to };
        document.getElementById('btnResetMonth').classList.remove('d-none');
        document.querySelector('.month-navigator').classList.add('opacity-50');
        updateMonthLabel();
        loadExpenses();
        _togglePopover(false);
    });

    document.getElementById('btnResetMonth').addEventListener('click', () => {
        _exitCustomMode();
        updateMonthLabel();
        loadExpenses();
    });

    // Cerrar popover al click fuera
    document.addEventListener('click', (e) => {
        const pop = document.getElementById('customRangePopover');
        if (!pop || pop.style.display === 'none') return;
        if (e.target.closest('#customRangePopover') ||
            e.target.closest('#btnCustomRange') ||
            e.target.closest('#currentMonthLabel')) return;
        pop.style.display = 'none';
    });

    // Form Submissions
    document.getElementById('expenseForm').addEventListener('submit', handleExpenseSubmit);

    // Category Change Logic inside Modal
    document.getElementById('inputCategoria').addEventListener('change', handleCategoryChange);

    // Auto-uncheck reminder when Paid
    document.getElementById('inputEstado').addEventListener('change', (e) => {
        if (e.target.value === 'Pagado') {
            document.getElementById('inputRecordatorio').checked = false;
        }
    });

    // Manual Toggle for Due Date Section
    document.getElementById('toggleVencimiento').addEventListener('change', (e) => {
        const section = document.getElementById('fixedExpenseSection');
        const inputVencimiento = document.getElementById('inputVencimiento');

        if (e.target.checked) {
            section.classList.remove('hidden');
            if (!inputVencimiento.value) inputVencimiento.required = true;
        } else {
            section.classList.add('hidden');
            inputVencimiento.required = false;
        }
    });

    // Back button support & ESC for all modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });

    window.addEventListener('popstate', (e) => {
        closeAllModals(true);
    });

    if (window.history.state && window.history.state.modal) {
        window.history.replaceState(null, "");
    }

    // RUC logic
    document.getElementById('inputRuc').addEventListener('input', handleRucSearch);
    document.getElementById('inputRuc').addEventListener('focus', handleRucSearch);
    document.getElementById('btnNewSupplier').addEventListener('click', () => {
        document.getElementById('formNewSupplier').reset();
        fcWizardReset(WIZARD_SUPPLIER, false);
        document.getElementById('modalNewSupplier').classList.add('active');
        pushModalState();
    });
    document.getElementById('btnQueryNewSupp').addEventListener('click', handleModalRucLookup);
    document.getElementById('formNewSupplier').addEventListener('submit', handleNewSupplierSubmit);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#inputRuc') && !e.target.closest('#rucSearchResults')) {
            document.getElementById('rucSearchResults').classList.add('d-none');
        }
    });

    // Global Paste Listener (Ctrl+V)
    document.addEventListener('paste', (e) => {
        // Only trigger if an attachment-capable modal is open
        const expenseModalActive = document.getElementById('detailExpenseModal').classList.contains('active');
        const paymentModalActive = document.getElementById('paymentModal').classList.contains('active');

        if (!expenseModalActive && !paymentModalActive) return;

        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1 || items[i].type.indexOf("pdf") !== -1) {
                const blob = items[i].getAsFile();

                // Stop other listeners if we found a file and a modal is active
                e.preventDefault();
                e.stopImmediatePropagation();

                if (paymentModalActive) {
                    // For payment modal, we add to the array immediately
                    currentPaymentAttachments.push({
                        file: blob,
                        blobUrl: URL.createObjectURL(blob),
                        categoria: (paymentCategories && paymentCategories.length > 0) ? paymentCategories[0] : 'Comprobante'
                    });
                    renderPaymentAttachmentsManager();
                    frappe.show_alert({ message: 'Archivo pegado', indicator: 'blue' });
                } else if (expenseModalActive) {
                    prepareAttachmentUpload(blob);
                }
                break; // Handle one at a time
            }
        }
    });
});

let categoriesData = [];
let attachmentCategories = [];
let paymentCategories = [];
let currentSelectedId = null;
let currentCorpAttachments = [];
let currentHistoryExpense = null;
let isModalPushed = false;

// ------------------------------------------------------------------
// CORE DATA & DASHBOARD LOGIC
// ------------------------------------------------------------------

function updateMonthLabel() {
    const lblEl = document.getElementById('currentMonthLabel');
    if (!lblEl) return;
    if (window.currentMode === 'custom' && window.customRange.from && window.customRange.to) {
        const fmt = (s) => {
            const [y, m, d] = s.split('-');
            return `${d}/${m}/${y.slice(2)}`;
        };
        lblEl.textContent = `${fmt(window.customRange.from)} → ${fmt(window.customRange.to)}`;
        lblEl.style.minWidth = '180px';
        return;
    }
    const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const month = months[window.currentDate.getMonth()];
    const year = window.currentDate.getFullYear();
    lblEl.textContent = `${month} ${year}`;
    lblEl.style.minWidth = '120px';
}

function loadInitialData() {
    frappe.call({
        method: "finhub.www.finanzas_corporativas.index.get_initial_data",
        callback: function (r) {
            if (r.message && !r.message.status) {
                categoriesData = r.message.categories || [];
                attachmentCategories = r.message.attachment_categories || [];
                paymentCategories = r.message.payment_categories || [];

                const catSelect = document.getElementById('inputCategoria');
                const quickVarCat = document.getElementById('qVarCategory');

                if (catSelect) {
                    while (catSelect.options.length > 1) catSelect.remove(1);
                }
                if (quickVarCat) {
                    while (quickVarCat.options.length > 1) quickVarCat.remove(1);
                }

                categoriesData.forEach(c => {
                    if (catSelect) catSelect.appendChild(new Option(c.name, c.name));
                    if (c.tipo_gasto === 'Variable' && quickVarCat) {
                        quickVarCat.appendChild(new Option(c.name, c.name));
                    }
                });

                const paySelect = document.getElementById('inputMetodoPago');
                if (paySelect) {
                    while (paySelect.options.length > 1) paySelect.remove(1);
                }

                (r.message.payment_methods || []).forEach(m => {
                    if (paySelect) paySelect.appendChild(new Option(m, m));
                    const payMethodModal = document.getElementById('payMethod');
                    if (payMethodModal) payMethodModal.appendChild(new Option(m, m));
                });

                const erpPaySelect = document.getElementById('payMethodERP');
                const erpBankSelect = document.getElementById('payBankAccountERP');
                if (erpPaySelect) {
                    while (erpPaySelect.options.length > 1) erpPaySelect.remove(1);
                    (r.message.erp_payment_modes || []).forEach(m => erpPaySelect.appendChild(new Option(m, m)));
                }
                if (erpBankSelect) {
                    while (erpBankSelect.options.length > 1) erpBankSelect.remove(1);
                    (r.message.erp_bank_accounts || []).forEach(a => erpBankSelect.appendChild(new Option(a.name, a.name)));
                }

                updateAttachmentCategorySelect();
            }
        }
    });
}

function loadExpenses() {
    let filterPayload;
    if (window.currentMode === 'custom' && window.customRange.from && window.customRange.to) {
        filterPayload = { start_date: window.customRange.from, end_date: window.customRange.to };
    } else {
        const year = window.currentDate.getFullYear();
        const month = (window.currentDate.getMonth() + 1).toString().padStart(2, '0');
        filterPayload = { month_date: `${year}-${month}-01` };
    }

    frappe.call({
        method: "finhub.www.finanzas_corporativas.index.get_expenses",
        args: { filters: JSON.stringify(filterPayload) },
        callback: function (r) {
            if (r.message && !r.message.status) {
                window.lastLoadedExpenses = r.message;
                renderDashboardLayout(r.message);
                updateStatsDashboard(r.message);
            }
        }
    });
}

function updateStatsDashboard(expenses) {
    let totalFixed = 0;
    let totalVariable = 0;
    let pendingFixedAmount = 0;
    let pendingVariableAmount = 0;
    let countPaidFixed = 0;
    let totalFixedCount = 0;
    let vCount = 0;

    expenses.forEach(e => {
        // Las Finanzas Cancelado representan compras revertidas; no se
        // suman al total ni al monto pendiente. Se siguen mostrando en
        // la lista del side drawer con su descripcion '[Cancelado] ...'.
        if (e.estado === 'Cancelado') return;

        const type = e.tipo || (categoriesData.find(c => c.name === e.categoria) || {}).tipo_gasto;
        const totalPaid = (e.pagos || []).reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
        const amount = parseFloat(e.monto || 0);

        if (type === 'Fijo') {
            totalFixed += amount;
            totalFixedCount++;
            if (e.estado === 'Pagado' || totalPaid >= amount) {
                countPaidFixed++;
            } else {
                pendingFixedAmount += Math.max(0, amount - totalPaid);
            }
        } else {
            totalVariable += amount;
            vCount++;
            if (e.estado !== 'Pagado' && totalPaid < amount) {
                pendingVariableAmount += Math.max(0, amount - totalPaid);
            }
        }
    });

    // Update KPI Cards
    let pendingTotal = pendingFixedAmount + pendingVariableAmount;

    document.getElementById('cardFixedAmount').textContent = `S/ ${formatCurrency(totalFixed)}`;
    document.getElementById('cardPaidLabel').textContent = `${countPaidFixed} de ${totalFixedCount} pagados`;
    document.getElementById('cardPaidCounter').textContent = countPaidFixed;
    document.getElementById('cardPaidSubLabel').textContent = `de ${totalFixedCount} costos fijos`;
    document.getElementById('cardPendingAmount').textContent = `S/ ${formatCurrency(pendingTotal)}`;

    document.getElementById('cardVariableAmount').textContent = `S/ ${formatCurrency(totalVariable)}`;
    document.getElementById('cardVariableLabel').textContent = `${vCount} transacciones`;

    // Progress bar for Fixed
    let pct = totalFixedCount > 0 ? Math.round((countPaidFixed / totalFixedCount) * 100) : 0;
    document.getElementById('fixedProgressLabel').textContent = `${countPaidFixed}/${totalFixedCount} pagados`;
    document.getElementById('fixedProgressPercent').textContent = `${pct}%`;
    document.getElementById('fixedProgressBar').style.width = `${pct}%`;
}

// ------------------------------------------------------------------
// RENDER COLUMNS (KPI tiles por categoria + side drawer)
// ------------------------------------------------------------------
let FC_GROUPS_FIXED = {};
let FC_GROUPS_VARIABLE = {};
let FC_OPEN_DRAWER = { catName: null, type: null };

const FC_ICON_PICKER_LIST = [
    // Personas
    'fa-user', 'fa-users', 'fa-user-tie', 'fa-user-md', 'fa-handshake',
    // Hogar / edificios
    'fa-home', 'fa-building', 'fa-store', 'fa-warehouse', 'fa-industry',
    // Servicios
    'fa-bolt', 'fa-tint', 'fa-wifi', 'fa-phone', 'fa-mobile-alt', 'fa-sim-card',
    // Transporte
    'fa-car', 'fa-truck', 'fa-plane', 'fa-motorcycle', 'fa-gas-pump',
    // Comida / compras
    'fa-utensils', 'fa-coffee', 'fa-apple-alt', 'fa-shopping-cart', 'fa-shopping-bag',
    // Oficina / digital
    'fa-laptop-code', 'fa-desktop', 'fa-server', 'fa-cloud', 'fa-rss', 'fa-briefcase',
    // Finanzas
    'fa-money-bill-wave', 'fa-credit-card', 'fa-receipt', 'fa-coins',
    'fa-file-invoice-dollar', 'fa-university', 'fa-piggy-bank',
    // Otros
    'fa-bullhorn', 'fa-gift', 'fa-heart', 'fa-star', 'fa-wrench',
    'fa-box', 'fa-tag', 'fa-balance-scale', 'fa-tools'
];

function fcBuildIconPicker(containerEl, currentIcon, onSelect) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    FC_ICON_PICKER_LIST.forEach(ic => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fc-icon-pick-btn';
        if (ic === currentIcon) btn.classList.add('active');
        btn.dataset.icon = ic;
        btn.innerHTML = `<i class="fas ${ic}"></i>`;
        btn.title = ic;
        btn.addEventListener('click', () => {
            containerEl.querySelectorAll('.fc-icon-pick-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (typeof onSelect === 'function') onSelect(ic);
        });
        containerEl.appendChild(btn);
    });
}

function fcResolveCategoryIconHTML(catName, type) {
    const meta = fcCategoryMeta(catName);
    if (meta.icono_imagen) {
        return `<img src="${meta.icono_imagen}" alt="${catName}">`;
    }
    if (meta.icono) {
        return `<i class="fas ${meta.icono}"></i>`;
    }
    return `<i class="fas ${fcCategoryFallbackIcon(catName, type)}"></i>`;
}

function fcCategoryFallbackIcon(catName, type) {
    const map = {
        'planilla': 'fa-users', 'salario': 'fa-users', 'sueldo': 'fa-users',
        'alquiler': 'fa-home', 'renta': 'fa-home',
        'software': 'fa-laptop-code', 'suscripcion': 'fa-rss', 'subscripcion': 'fa-rss',
        'servicio': 'fa-bolt', 'agua': 'fa-tint', 'luz': 'fa-bolt',
        'internet': 'fa-wifi', 'telefon': 'fa-phone', 'celular': 'fa-mobile-alt',
        'marketing': 'fa-bullhorn', 'publicidad': 'fa-bullhorn',
        'impuesto': 'fa-file-invoice-dollar', 'sunat': 'fa-file-invoice-dollar',
        'caja chica': 'fa-money-bill-wave', 'compra': 'fa-shopping-cart',
        'transporte': 'fa-truck', 'envio': 'fa-truck',
        'comida': 'fa-utensils', 'oficina': 'fa-briefcase',
        'asesoria': 'fa-user-tie', 'legal': 'fa-balance-scale', 'banco': 'fa-university',
    };
    const lower = (catName || '').toLowerCase();
    for (const key in map) {
        if (lower.includes(key)) return map[key];
    }
    return type === 'Fijo' ? 'fa-home' : 'fa-receipt';
}

function fcDefaultColor(type) {
    return type === 'Fijo' ? '#ef4444' : '#10b981';
}

function fcCategoryMeta(catName) {
    return categoriesData.find(c => c.name === catName) || {};
}

function fcApplyMobileTab(tab) {
    const row = document.getElementById('fcDashboardRow');
    if (!row) return;
    row.setAttribute('data-mobile-tab', tab);
    document.querySelectorAll('.fc-mobile-tab').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    try { localStorage.setItem('fcMobileTab', tab); } catch (e) { }
}

function fcUpdateMobileTabCounts() {
    const fCount = Object.keys(FC_GROUPS_FIXED).length;
    const vCount = Object.keys(FC_GROUPS_VARIABLE).length;
    const fEl = document.getElementById('fcMobileTabCountFijo');
    const vEl = document.getElementById('fcMobileTabCountVariable');
    if (fEl) fEl.textContent = fCount;
    if (vEl) vEl.textContent = vCount;
}

function renderDashboardLayout(expenses) {
    const fixedList = document.getElementById('fixedListContainer');
    const variableList = document.getElementById('variableListContainer');

    fixedList.innerHTML = '';
    variableList.innerHTML = '';

    FC_GROUPS_FIXED = {};
    FC_GROUPS_VARIABLE = {};

    // Seed buckets with ALL categories (incluso sin registros este mes)
    categoriesData.forEach(c => {
        const bucket = c.tipo_gasto === 'Fijo' ? FC_GROUPS_FIXED : FC_GROUPS_VARIABLE;
        bucket[c.name] = { items: [], total: 0, paid: 0, pending: 0, paidCount: 0 };
    });

    // Aggregate expenses
    expenses.forEach(exp => {
        const type = exp.tipo || fcCategoryMeta(exp.categoria).tipo_gasto;
        const totalPaid = (exp.pagos || []).reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
        const amount = parseFloat(exp.monto || 0);
        const cat = exp.categoria || 'Sin categoria';
        const isCancelled = exp.estado === 'Cancelado';
        const isPaid = (exp.estado === 'Pagado' || totalPaid >= amount);

        const bucket = type === 'Fijo' ? FC_GROUPS_FIXED : FC_GROUPS_VARIABLE;
        if (!bucket[cat]) bucket[cat] = { items: [], total: 0, paid: 0, pending: 0, paidCount: 0 };
        // Las canceladas se siguen mostrando en la lista del drawer (para
        // trazabilidad) pero NO suman al total ni al pending de la
        // categoria.
        bucket[cat].items.push({ exp, type, amount, totalPaid, isPaid, isCancelled });
        if (isCancelled) return;
        bucket[cat].total += amount;
        bucket[cat].paid += Math.min(totalPaid, amount);
        if (isPaid) bucket[cat].paidCount++;
        else bucket[cat].pending += Math.max(0, amount - totalPaid);
    });

    // Sort: by count desc, then pending desc, then alphabetically
    const sortKeys = (groups) => Object.keys(groups).sort((a, b) => {
        const la = groups[a].items.length;
        const lb = groups[b].items.length;
        if (la !== lb) return lb - la;
        if (groups[a].pending !== groups[b].pending) return groups[b].pending - groups[a].pending;
        return a.localeCompare(b);
    });

    const fixedKeys = sortKeys(FC_GROUPS_FIXED);
    const variableKeys = sortKeys(FC_GROUPS_VARIABLE);

    fixedKeys.forEach(cat => fixedList.appendChild(createCategoryTile(cat, FC_GROUPS_FIXED[cat], 'Fijo')));
    variableKeys.forEach(cat => variableList.appendChild(createCategoryTile(cat, FC_GROUPS_VARIABLE[cat], 'Variable')));

    if (fixedKeys.length === 0) {
        fixedList.innerHTML = '<div class="text-center p-4 text-muted border rounded mx-auto w-100 fs-7">No hay categorias fijas. Crea una desde el wizard.</div>';
    }
    if (variableKeys.length === 0) {
        variableList.innerHTML = '<div class="text-center p-5 text-muted border rounded border-dashed mx-auto w-100 fs-7">Sin categorias variables. Crea una desde el wizard.</div>';
    }

    // Refrescar drawer si estaba abierto
    if (FC_OPEN_DRAWER.catName) {
        const current = (FC_OPEN_DRAWER.type === 'Fijo' ? FC_GROUPS_FIXED : FC_GROUPS_VARIABLE)[FC_OPEN_DRAWER.catName];
        if (current) renderDrawerContent(FC_OPEN_DRAWER.catName, FC_OPEN_DRAWER.type, current);
        else closeCategoryDrawer();
    }

    fcUpdateMobileTabCounts();
}

function createCategoryTile(catName, groupData, type) {
    const tile = document.createElement('div');
    tile.className = 'fc-cat-tile';
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.dataset.cat = catName;
    tile.dataset.type = type;

    const meta = fcCategoryMeta(catName);
    const color = meta.color || fcDefaultColor(type);
    const imgTag = fcResolveCategoryIconHTML(catName, type);

    const pendBadge = groupData.pending > 0
        ? `<span class="fc-cat-tile-pend"><i class="fas fa-clock"></i> S/ ${formatCurrency(groupData.pending)}</span>`
        : (groupData.items.length > 0
            ? `<span class="fc-cat-tile-paid"><i class="fas fa-check"></i> al dia</span>`
            : `<span class="fc-cat-tile-empty">sin registros</span>`);

    tile.innerHTML = `
        <button type="button" class="fc-cat-tile-add" title="Agregar a ${catName.replace(/"/g, '&quot;')}">
            <i class="fas fa-plus"></i>
        </button>
        <div class="fc-cat-tile-icon" style="--cat-color: ${color};">${imgTag}</div>
        <div class="fc-cat-tile-name" title="${catName}">${catName}</div>
        <div class="fc-cat-tile-count">${groupData.items.length} ${groupData.items.length === 1 ? 'registro' : 'registros'}</div>
        <div class="fc-cat-tile-total">S/ ${formatCurrency(groupData.total)}</div>
        <div class="fc-cat-tile-status">${pendBadge}</div>
    `;

    tile.addEventListener('click', () => openCategoryDrawer(catName, type));
    tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCategoryDrawer(catName, type); }
    });

    const addBtn = tile.querySelector('.fc-cat-tile-add');
    addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openNewExpense(type, catName);
    });

    return tile;
}

// ------------------------------------------------------------------
// CATEGORY DRAWER (lista filtrada por categoria)
// ------------------------------------------------------------------
function openCategoryDrawer(catName, type) {
    const bucket = type === 'Fijo' ? FC_GROUPS_FIXED : FC_GROUPS_VARIABLE;
    const data = bucket[catName];
    if (!data) return;

    FC_OPEN_DRAWER = { catName, type };
    renderDrawerContent(catName, type, data);

    document.getElementById('categoryDrawer').classList.add('active');
    document.getElementById('catDrawerBackdrop').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function renderDrawerContent(catName, type, data) {
    const meta = fcCategoryMeta(catName);
    const color = meta.color || fcDefaultColor(type);
    const iconEl = document.getElementById('catDrawerIcon');
    iconEl.style.setProperty('--cat-color', color);
    iconEl.innerHTML = fcResolveCategoryIconHTML(catName, type);

    document.getElementById('catDrawerName').textContent = catName;

    const pendTxt = data.pending > 0
        ? `Pendiente: S/ ${formatCurrency(data.pending)}`
        : (data.items.length > 0 ? 'Al dia' : 'Sin registros en este mes');
    document.getElementById('catDrawerMeta').textContent =
        `${type} · ${data.items.length} registros · Total S/ ${formatCurrency(data.total)} · ${pendTxt}`;

    // List
    const body = document.getElementById('catDrawerBody');
    body.innerHTML = '';
    if (data.items.length === 0) {
        body.innerHTML = `<div class="fc-cat-drawer-empty">
            <i class="fas fa-inbox"></i>
            <p>Esta categoria no tiene registros este mes.</p>
            <button class="btn btn-primary btn-sm rounded-pill" onclick="addExpenseFromDrawer()">
                <i class="fas fa-plus me-1"></i> Crear el primero
            </button>
        </div>`;
        return;
    }

    const sorted = [...data.items].sort((a, b) => {
        if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
        return (b.exp.fecha || '').localeCompare(a.exp.fecha || '');
    });
    sorted.forEach(it => body.appendChild(createExpenseHTMLCard(it.exp, it.type, it.amount, it.totalPaid)));
}

window.closeCategoryDrawer = function () {
    document.getElementById('categoryDrawer').classList.remove('active');
    document.getElementById('catDrawerBackdrop').classList.remove('active');
    document.body.style.overflow = '';
    FC_OPEN_DRAWER = { catName: null, type: null };
};

window.addExpenseFromDrawer = function () {
    if (!FC_OPEN_DRAWER.catName) return;
    openNewExpense(FC_OPEN_DRAWER.type, FC_OPEN_DRAWER.catName);
};

// ------------------------------------------------------------------
// CATEGORY APPEARANCE (icono imagen + color)
// ------------------------------------------------------------------
let FC_APPR_TARGET = null;
let FC_APPR_PENDING_IMAGE = null; // null = sin cambio; '' = quitar; string = nueva url
let FC_APPR_NEW_FILE = null;
let FC_APPR_PENDING_ICON = null; // null = sin cambio desde meta actual; '' = quitar; string = nuevo

function fcApprRefreshPreview() {
    if (!FC_APPR_TARGET) return;
    const meta = fcCategoryMeta(FC_APPR_TARGET);
    const type = FC_OPEN_DRAWER.type || meta.tipo_gasto;
    const preview = document.getElementById('catApprPreview');
    if (!preview) return;

    // Imagen prioridad: file nuevo > meta.icono_imagen (si PENDING_IMAGE no vacia) > ninguna
    let imageHTML = null;
    if (FC_APPR_NEW_FILE) {
        // usa ya el reader en handler; saltar aqui
        return;
    }
    if (FC_APPR_PENDING_IMAGE !== '' && meta.icono_imagen) {
        imageHTML = `<img src="${meta.icono_imagen}" alt="">`;
    }

    if (imageHTML) {
        preview.innerHTML = imageHTML;
        return;
    }

    // Sin imagen → icono custom (si hay) o fallback
    const effectiveIcon = (FC_APPR_PENDING_ICON !== null)
        ? FC_APPR_PENDING_ICON
        : (meta.icono || '');
    if (effectiveIcon) {
        preview.innerHTML = `<i class="fas ${effectiveIcon}"></i>`;
    } else {
        preview.innerHTML = `<i class="fas ${fcCategoryFallbackIcon(FC_APPR_TARGET, type)}"></i>`;
    }
}

window.openCategoryAppearance = function () {
    if (!FC_OPEN_DRAWER.catName) return;
    FC_APPR_TARGET = FC_OPEN_DRAWER.catName;
    FC_APPR_PENDING_IMAGE = null;
    FC_APPR_NEW_FILE = null;
    FC_APPR_PENDING_ICON = null;

    const meta = fcCategoryMeta(FC_APPR_TARGET);
    const type = FC_OPEN_DRAWER.type;
    const color = meta.color || fcDefaultColor(type);

    const preview = document.getElementById('catApprPreview');
    preview.style.setProperty('--cat-color', color);

    document.getElementById('catApprName').textContent = FC_APPR_TARGET;
    document.getElementById('catApprColor').value = color;
    document.getElementById('catApprColorValue').textContent = color;
    document.getElementById('catApprImageInput').value = '';

    // Build icon picker
    const pickerEl = document.getElementById('catApprIconPicker');
    fcBuildIconPicker(pickerEl, meta.icono || '', (ic) => {
        FC_APPR_PENDING_ICON = ic;
        fcApprRefreshPreview();
    });

    fcApprRefreshPreview();

    document.getElementById('categoryAppearanceModal').classList.add('active');
};

window.closeCategoryAppearance = function () {
    document.getElementById('categoryAppearanceModal').classList.remove('active');
    FC_APPR_TARGET = null;
    FC_APPR_NEW_FILE = null;
    FC_APPR_PENDING_IMAGE = null;
    FC_APPR_PENDING_ICON = null;
};

window.saveCategoryAppearance = async function () {
    if (!FC_APPR_TARGET) return;
    const btn = document.getElementById('catApprSaveBtn');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

    try {
        let newImageUrl = fcCategoryMeta(FC_APPR_TARGET).icono_imagen || null;

        if (FC_APPR_NEW_FILE) {
            const uploaded = await uploadCategoryIcon(FC_APPR_NEW_FILE);
            if (!uploaded) throw new Error('No se pudo subir la imagen');
            newImageUrl = uploaded;
        } else if (FC_APPR_PENDING_IMAGE === '') {
            newImageUrl = null;
        }

        const color = document.getElementById('catApprColor').value;

        // Resolver icono final
        const currentIcon = fcCategoryMeta(FC_APPR_TARGET).icono || null;
        let finalIcon;
        if (FC_APPR_PENDING_ICON === null) finalIcon = currentIcon;
        else if (FC_APPR_PENDING_ICON === '') finalIcon = null;
        else finalIcon = FC_APPR_PENDING_ICON;

        const resp = await frappe.call({
            method: "finhub.www.finanzas_corporativas.index.update_category_appearance",
            args: {
                name: FC_APPR_TARGET,
                icono_imagen: newImageUrl,
                color: color,
                icono: finalIcon
            }
        });

        if (resp.message && resp.message.status === 'success') {
            const updated = resp.message.data;
            const cat = categoriesData.find(c => c.name === updated.name);
            if (cat) {
                cat.icono_imagen = updated.icono_imagen;
                cat.icono = updated.icono;
                cat.color = updated.color;
            }
            frappe.show_alert({ message: 'Apariencia guardada', indicator: 'green' });
            closeCategoryAppearance();
            // re-render
            if (window.lastLoadedExpenses) renderDashboardLayout(window.lastLoadedExpenses);
        } else {
            frappe.show_alert({ message: (resp.message && resp.message.message) || 'Error al guardar', indicator: 'red' });
        }
    } catch (err) {
        frappe.show_alert({ message: 'Error: ' + (err.message || err), indicator: 'red' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
};

async function uploadCategoryIcon(file) {
    const formData = new FormData();
    const uniqueName = `${file.name.replace(/\.[^/.]+$/, '')}_${Date.now()}${(file.name.match(/\.[^/.]+$/) || ['.png'])[0]}`;
    const f = new File([file], uniqueName, { type: file.type });
    formData.append('file', f);
    formData.append('file_name', uniqueName);
    formData.append('is_private', 0);
    const resp = await fetch('/api/method/upload_file', {
        method: 'POST',
        headers: { 'X-Frappe-CSRF-Token': frappe.csrf_token },
        body: formData
    });
    const data = await resp.json();
    return (data.message && data.message.file_url) || null;
}

function createExpenseHTMLCard(exp, type, amount, totalPaid) {
    const card = document.createElement('div');
    card.className = 'expense-item bg-white p-3 d-flex justify-content-between align-items-center mb-1 shadow-sm';
    card.dataset.id = exp.name;
    card.onclick = () => showExpenseDetailByClick(exp.name);

    const titleText = exp.descripcion || exp.categoria;
    const subtitleCat = exp.descripcion ? `<span class="text-xs text-muted d-block"><i class="fas fa-tag me-1"></i>${exp.categoria}</span>` : '';
    const isCancelled = exp.estado === 'Cancelado';

    // Las Finanzas Cancelado se muestran en gris con badge "CANCELADO" y
    // monto tachado. No suman al pendiente del header (filtrado en
    // updateMetrics y en el aggregate por categoria).
    if (isCancelled) {
        card.style.opacity = '0.55';
        card.innerHTML = `
            <div class="d-flex align-items-center gap-3">
                <div class="icon-square bg-neutral-100 text-neutral-600 rounded"><i class="fas fa-ban"></i></div>
                <div>
                    <h6 class="m-0 fw-bold text-dark d-flex align-items-center">${titleText}
                        <span class="badge bg-neutral-100 text-neutral-700 border ms-2">CANCELADO</span>
                    </h6>
                    ${subtitleCat}
                </div>
            </div>
            <div class="fw-bold text-muted fs-6" style="text-decoration: line-through;">S/ ${formatCurrency(amount)}</div>
        `;
        return card;
    }

    if (type === 'Fijo') {
        const isPaid = (exp.estado === 'Pagado' || totalPaid >= amount);
        const iconSection = isPaid
            ? `<div class="icon-square bg-success text-white rounded-circle"><i class="fas fa-check"></i></div>`
            : `<div class="icon-square bg-danger-50 text-danger rounded-circle"><i class="fas fa-times"></i></div>`;
        const dateDesc = exp.fecha_vencimiento ? `Vence: ${formatDateOnly(exp.fecha_vencimiento)}` : `Sin vencimiento estricto`;
        const badge = isPaid ? `<span class="badge bg-success-light text-success border border-success-light ms-2">PAGADO</span>` : `<span class="badge bg-danger-light text-danger border border-danger-light ms-2">PENDIENTE</span>`;
        const employeeLine = exp.empleado_nombre ? `<span class="text-xs text-primary fw-bold"><i class="fas fa-user me-1"></i>${exp.empleado_nombre}</span><br>` : '';

        card.innerHTML = `
            <div class="d-flex align-items-center gap-3">
                ${iconSection}
                <div>
                    <h6 class="m-0 fw-bold text-dark d-flex align-items-center">${titleText} ${badge}</h6>
                    ${employeeLine}
                    ${subtitleCat}
                    <span class="text-xs text-muted"><i class="fas fa-calendar-alt me-1"></i> ${dateDesc}</span>
                </div>
            </div>
            <div class="fw-bold ${isPaid ? 'text-dark' : 'text-danger'} fs-6">S/ ${formatCurrency(amount)}</div>
        `;
    } else {
        // Variable
        const hasPayment = totalPaid > 0;
        card.innerHTML = `
            <div class="d-flex align-items-center gap-3">
                <div class="icon-square bg-neutral-100 text-neutral-600 rounded"><i class="fas fa-receipt"></i></div>
                <div>
                    <h6 class="m-0 fw-bold text-dark">${titleText}</h6>
                    ${subtitleCat}
                </div>
            </div>
            <div class="text-end">
                <div class="fw-bold fs-6">S/ ${formatCurrency(amount)}</div>
                ${hasPayment ? `<span class="text-xs text-success fw-bold">Pagado: S/ ${formatCurrency(totalPaid)}</span>` : `<span class="text-xs text-warning fw-bold">No Pagado</span>`}
            </div>
        `;
    }
    return card;
}


// ------------------------------------------------------------------
// MODAL: DETAIL / EDIT
// ------------------------------------------------------------------
function showExpenseDetailByClick(expenseId) {
    const exp = window.lastLoadedExpenses.find(e => e.name === expenseId);
    if (exp) {
        showExpenseDetail(exp);
    }
}

function replicarFijosMesAnterior() {
    if (!confirm('Se replicaran los gastos fijos del mes anterior al mes actual.\n\nNo se duplica lo que ya existe. La categoria Planilla se omite (tiene su propio mecanismo de sync).\n\n¿Continuar?')) return;
    const btn = event && event.target ? event.target.closest('button') : null;
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Replicando...'; }
    frappe.call({
        method: 'finhub.www.finanzas_corporativas.index.replicate_fixed_expenses',
        callback: function(r) {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; }
            const m = r.message || {};
            if (m.status === 'success' || m.status === 'noop') {
                alert(`Periodo: ${m.periodo || ''} (fuente ${m.fuente || ''})\n\nCreados: ${m.creados || 0}\nOmitidos (ya existian): ${m.omitidos || 0}\n\n${m.message || ''}`);
                if (window.location.reload) window.location.reload();
            } else {
                alert('Error: ' + (m.message || 'no se pudo replicar'));
            }
        },
        error: function() {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; }
            alert('Error de red al replicar');
        }
    });
}

function openNewExpense(typeForce = null, categoriaForce = null) {
    document.getElementById('expenseForm').reset();
    document.getElementById('expenseId').value = '';
    document.getElementById('paneTitle').textContent = 'Nuevo Gasto Corp.';
    document.getElementById('btnDelete').classList.add('d-none');
    document.getElementById('btnViewPayments')?.classList.add('d-none');

    document.getElementById('inputFecha').valueAsDate = new Date();
    document.getElementById('badgeTipo').textContent = 'Seleccione categoría';
    document.getElementById('inputEstadoContador').value = 'Pendiente';

    currentCorpAttachments = [];
    renderAttachmentsListCorp();

    const toggle = document.getElementById('toggleVencimiento');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    fcWizardReset(WIZARD_EXPENSE, false);

    suspendCategoryDrawer();
    document.getElementById('detailExpenseModal').classList.add('active');
    pushModalState();

    // Pre-select category if invoked from a category group quick-add button
    if (categoriaForce) {
        const catSel = document.getElementById('inputCategoria');
        const exists = Array.from(catSel.options).some(o => o.value === categoriaForce);
        if (exists) {
            catSel.value = categoriaForce;
            catSel.dispatchEvent(new Event('change'));
        }
    }
}

function showExpenseDetail(exp) {
    document.getElementById('paneTitle').textContent = 'Editar Gasto Corp.';
    document.getElementById('btnDelete').classList.remove('d-none');
    document.getElementById('btnViewPayments')?.classList.remove('d-none');

    document.getElementById('expenseId').value = exp.name;
    document.getElementById('inputMonto').value = exp.monto;
    document.getElementById('inputFecha').value = exp.fecha;
    document.getElementById('inputCategoria').value = exp.categoria;
    document.getElementById('inputDescripcion').value = exp.descripcion;
    document.getElementById('inputMetodoPago').value = exp.metodo_pago;

    // Corp Fields
    document.getElementById('inputProveedor').value = exp.proveedor || '';
    document.getElementById('inputRuc').value = exp.ruc || '';
    document.getElementById('inputEstadoContador').value = exp.estado_contador || 'Pendiente';

    const catEvent = new Event('change');
    document.getElementById('inputCategoria').dispatchEvent(catEvent);

    if (exp.fecha_vencimiento) {
        const toggle = document.getElementById('toggleVencimiento');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        document.getElementById('inputVencimiento').value = exp.fecha_vencimiento;
        document.getElementById('inputEstado').value = exp.estado;
        document.getElementById('inputRecordatorio').checked = !!exp.recordatorio_activo;
    } else {
        const toggle = document.getElementById('toggleVencimiento');
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
    }

    currentCorpAttachments = [];
    if (exp.adjuntos && Array.isArray(exp.adjuntos)) {
        currentCorpAttachments = exp.adjuntos.map(a => ({
            file_url: a.archivo,
            category: a.categoria
        }));
    }

    renderAttachmentsListCorp();

    fcWizardReset(WIZARD_EXPENSE, true);

    suspendCategoryDrawer();
    document.getElementById('detailExpenseModal').classList.add('active');
    pushModalState();
}

function closeDetailModal() {
    document.getElementById('detailExpenseModal').classList.remove('active');
    clearModalState();
    restoreCategoryDrawer();
}

function suspendCategoryDrawer() {
    if (!FC_OPEN_DRAWER.catName) return;
    const drawer = document.getElementById('categoryDrawer');
    const backdrop = document.getElementById('catDrawerBackdrop');
    if (drawer) drawer.classList.add('suspended');
    if (backdrop) backdrop.classList.add('suspended');
}

function restoreCategoryDrawer() {
    if (!FC_OPEN_DRAWER.catName) return;
    const drawer = document.getElementById('categoryDrawer');
    const backdrop = document.getElementById('catDrawerBackdrop');
    if (drawer) drawer.classList.remove('suspended');
    if (backdrop) backdrop.classList.remove('suspended');
    document.body.style.overflow = 'hidden';
}

function deleteCurrentExpense() {
    const name = document.getElementById('expenseId').value;
    if (!name) return;

    frappe.confirm('¿Eliminar definitivamente este registro?', () => {
        frappe.call({
            method: "finhub.www.finanzas_corporativas.index.delete_expense",
            args: { name: name },
            callback: function (r) {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert('Gasto eliminado');
                    closeDetailModal();
                    loadExpenses();
                }
            }
        });
    });
}

function handleExpenseSubmit(e) {
    e.preventDefault();

    for (let s = 1; s <= WIZARD_EXPENSE.totalSteps; s++) {
        if (!WIZARD_EXPENSE.validateStep(s)) {
            WIZARD_EXPENSE.currentStep = s;
            fcWizardRender(WIZARD_EXPENSE);
            return;
        }
    }

    const btn = document.getElementById('btnSave');
    const originalText = btn.innerHTML;
    const restoreBtn = () => { btn.disabled = false; btn.innerHTML = originalText; };

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

    try {
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        data.recordatorio_activo = document.getElementById('inputRecordatorio').checked ? 1 : 0;
        data.adjuntos = currentCorpAttachments.map(a => ({
            categoria: a.category,
            archivo: a.file_url
        }));

        frappe.call({
            method: "finhub.www.finanzas_corporativas.index.save_expense",
            args: { data: JSON.stringify(data) },
            callback: function (r) {
                restoreBtn();

                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: 'Gasto guardado exitosamente', indicator: 'green' });
                    closeDetailModal();
                    loadExpenses();
                } else {
                    const msg = (r.message && r.message.message) || 'No se pudo guardar el gasto';
                    frappe.show_alert({ message: msg, indicator: 'red' });
                }
            },
            error: function () {
                restoreBtn();
                frappe.show_alert({ message: 'Error de red al guardar. Reintente.', indicator: 'red' });
            }
        });
    } catch (err) {
        restoreBtn();
        frappe.show_alert({ message: 'Error inesperado: ' + (err && err.message || err), indicator: 'red' });
    }
}

// ------------------------------------------------------------------
// REST OF UNMODIFIED UTILS & MODALS LOGIC
// ------------------------------------------------------------------
function closeAllModals(fromPopState = false) {
    document.getElementById('detailExpenseModal').classList.remove('active');
    document.getElementById('attachmentCategoryModal').classList.remove('active');
    document.getElementById('modalNewSupplier').classList.remove('active');
    document.getElementById('paymentModal').classList.remove('active');
    document.getElementById('paymentsHistoryModal').classList.remove('active');
    document.getElementById('quickCreateModal').classList.remove('active');
    const catApprModal = document.getElementById('categoryAppearanceModal');
    if (catApprModal) catApprModal.classList.remove('active');
    const catDrawer = document.getElementById('categoryDrawer');
    const catDrawerBackdrop = document.getElementById('catDrawerBackdrop');
    if (catDrawer) catDrawer.classList.remove('active');
    if (catDrawerBackdrop) catDrawerBackdrop.classList.remove('active');
    document.body.style.overflow = '';
    FC_OPEN_DRAWER = { catName: null, type: null };

    if (!fromPopState) clearModalState();
}

function updateAttachmentCategorySelect() {
    const sel = document.getElementById('attachmentCategorySelect');
    if (sel) {
        sel.innerHTML = '<option value="">Seleccione...</option>';
        attachmentCategories.forEach(c => {
            sel.appendChild(new Option(c, c));
        });
    }
}

function handleCategoryChange(e) {
    const selectedName = e.target.value;
    const catData = categoriesData.find(c => c.name === selectedName);
    const typeIndicator = document.getElementById('badgeTipo');
    const typeInput = document.getElementById('inputTipo');

    if (catData) {
        const type = catData.tipo_gasto;
        typeInput.value = type;
        typeIndicator.textContent = type;
        const toggle = document.getElementById('toggleVencimiento');
        if (type === 'Fijo') {
            typeIndicator.className = 'badge badge-neutral bg-primary-light text-primary border';
            toggle.checked = true;
        } else {
            typeIndicator.className = 'badge badge-neutral border';
            toggle.checked = false;
        }
        toggle.dispatchEvent(new Event('change'));
    } else {
        typeIndicator.textContent = 'Seleccione categoría';
    }
}

function handleRucSearch(e) {
    const query = e.target.value.trim();
    const results = document.getElementById('rucSearchResults');
    frappe.call({
        method: "finhub.www.finanzas_corporativas.index.search_proveedores",
        args: { query: query },
        callback: function (r) {
            if (r.message && r.message.length > 0) {
                renderRucSearchResults(r.message);
                results.classList.remove('d-none');
            } else {
                results.classList.add('d-none');
            }
        }
    });
}

function renderRucSearchResults(proveedores) {
    const results = document.getElementById('rucSearchResults');
    results.innerHTML = '';
    proveedores.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ruc-search-item';
        item.innerHTML = `<div class="fw-bold fs-7">${p.ruc}</div><div class="text-muted fs-xs">${p.nombre_razon_social}</div>`;
        item.onclick = () => {
            document.getElementById('inputRuc').value = p.ruc;
            document.getElementById('inputProveedor').value = p.nombre_razon_social;
            results.classList.add('d-none');
        };
        results.appendChild(item);
    });
}

function handleModalRucLookup() {
    // Exact same API Factiliza Code
    const val = document.getElementById('newSuppRuc').value.trim();
    if (!val) return frappe.show_alert('Ingrese RUC/DNI');

    const btn = document.getElementById('btnQueryNewSupp');
    const original = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    const method = val.length === 8 ? 'consultar_dni' : 'consultar_ruc';

    frappe.call({
        method: `finhub.www.finanzas_corporativas.index.${method}`,
        args: { [val.length === 8 ? 'dni' : 'ruc']: val },
        callback: function (r) {
            btn.disabled = false; btn.innerHTML = original;
            if (r.message && r.message.success) {
                const data = r.message.data;
                document.getElementById('newSuppName').value = method === 'consultar_dni' ? data.nombre_completo || `${data.nombres} ${data.apellido_paterno}` : data.nombre_o_razon_social;
                if (data.direccion) document.getElementById('newSuppAddress').value = data.direccion;
                if (data.departamento) document.getElementById('newSuppDept').value = data.departamento;
                if (data.provincia) document.getElementById('newSuppProv').value = data.provincia;
                if (data.distrito) document.getElementById('newSuppDist').value = data.distrito;
                frappe.show_alert('Datos recuperados', 'green');
            } else {
                frappe.msgprint('Error en consulta');
            }
        }
    });
}

function handleNewSupplierSubmit(e) {
    e.preventDefault();

    for (let s = 1; s <= WIZARD_SUPPLIER.totalSteps; s++) {
        if (!WIZARD_SUPPLIER.validateStep(s)) {
            WIZARD_SUPPLIER.currentStep = s;
            fcWizardRender(WIZARD_SUPPLIER);
            return;
        }
    }

    const data = {
        ruc: document.getElementById('newSuppRuc').value,
        nombre_razon_social: document.getElementById('newSuppName').value,
        direccion: document.getElementById('newSuppAddress').value,
        departamento: document.getElementById('newSuppDept').value,
        provincia: document.getElementById('newSuppProv').value,
        distrito: document.getElementById('newSuppDist').value,
        web: document.getElementById('newSuppWeb').value
    };

    frappe.call({
        method: "finhub.www.finanzas_corporativas.index.create_proveedor",
        args: { data: data },
        callback: function (r) {
            if (r.message && r.message.status === 'success') {
                frappe.show_alert('Proveedor guardado');
                document.getElementById('inputRuc').value = r.message.data.ruc;
                document.getElementById('inputProveedor').value = r.message.data.nombre_razon_social;
                closeAllModals();
                document.getElementById('detailExpenseModal').classList.add('active'); // keep it open
            } else if (r.message && r.message.status === 'error') {
                frappe.show_alert({ message: r.message.message || 'No se pudo crear el proveedor', indicator: 'red' }, 7);
            } else {
                frappe.show_alert({ message: 'Respuesta inesperada del servidor', indicator: 'red' }, 7);
            }
        },
        error: function (err) {
            const msg = (err && err.message) || 'Error al guardar proveedor';
            frappe.show_alert({ message: msg, indicator: 'red' }, 7);
        }
    });
}

function closeModalNewSupplier() {
    document.getElementById('modalNewSupplier').classList.remove('active');
}


function renderAttachmentsListCorp() {
    const container = document.getElementById('attachmentsListCorp');
    container.innerHTML = '';

    if (currentCorpAttachments.length === 0) {
        container.innerHTML = '<p class="text-muted small m-auto py-4 fst-italic">No hay adjuntos.</p>';
        return;
    }

    currentCorpAttachments.forEach((att, index) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';

        let iconHtml = '';
        if (att.file_url.toLowerCase().endsWith('.pdf')) {
            iconHtml = `<div class="w-100 h-100 d-flex align-items-center justify-content-center bg-white"><i class="fas fa-file-pdf fa-2x text-danger"></i></div>`;
        } else {
            iconHtml = `<img src="${att.file_url}" alt="Adjunto">`;
        }

        item.innerHTML = `
            ${iconHtml}
            <div class="file-label text-truncate pb-2" style="font-size: 8px;">${att.category || 'Img'}</div>
            <button type="button" class="btn-remove-att">
                <i class="fas fa-times"></i>
            </button>
        `;

        const removeBtn = item.querySelector('.btn-remove-att');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            currentCorpAttachments.splice(index, 1);
            renderAttachmentsListCorp();
        });

        item.addEventListener('click', (e) => {
            if (e.target.closest('.btn-remove-att')) return;
            window.open(att.file_url, '_blank');
        });

        container.appendChild(item);
    });
}

window.removeAttachmentCorp = function (index) {
    currentCorpAttachments.splice(index, 1);
    renderAttachmentsListCorp();
}

// ----------------------------------------------------
// PAYMENT MODAL (KEPT IDENTICAL FROM SPLIT PANE LOGIC)
// ----------------------------------------------------
function openPaymentsHistory(e, expenseId) {
    e.stopPropagation(); // Avoid triggering card click
    currentSelectedId = expenseId;

    // Find expense obj to render stats
    const exp = window.lastLoadedExpenses.find(x => x.name === expenseId);
    if (exp) {
        currentHistoryExpense = exp;
        document.getElementById('phExpenseTitle').textContent = `Gasto: ${exp.categoria} | ${formatDateOnly(exp.fecha)}`;
        const total = parseFloat(exp.monto || 0);
        const paid = (exp.pagos || []).reduce((s, p) => s + parseFloat(p.monto || 0), 0);

        document.getElementById('phTotal').textContent = `S/ ${formatCurrency(total)}`;
        document.getElementById('phPaid').textContent = `S/ ${formatCurrency(paid)}`;
        document.getElementById('phPending').textContent = `S/ ${formatCurrency(Math.max(0, total - paid))}`;

        renderPaymentsHistoryList(exp.pagos || [], expenseId);
    }

    document.getElementById('paymentsHistoryModal').classList.add('active');
    pushModalState();
}

function closePaymentsHistory(fromHistory = false) {
    document.getElementById('paymentsHistoryModal').classList.remove('active');
}

function renderPaymentsHistoryList(pagos, expenseId) {
    const list = document.getElementById('paymentsHistoryList');
    list.innerHTML = '';

    if (!pagos || pagos.length === 0) {
        list.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted small">No hay pagos registrados.</td></tr>`;
        return;
    }

    pagos.forEach(p => {
        let attachmentsHtml = '';
        if (p.adjuntos && p.adjuntos.length > 0) {
            attachmentsHtml = `<div class="mt-1 d-flex gap-1 flex-wrap">`;
            p.adjuntos.forEach(att => {
                const url = att.adjunto;
                const isPdf = url.toLowerCase().endsWith('.pdf');
                attachmentsHtml += `
                    <a href="${url}" target="_blank" class="badge bg-light text-primary border d-flex align-items-center gap-1 text-decoration-none" title="${att.categoria_pago || 'Adjunto'}">
                        <i class="fas ${isPdf ? 'fa-file-pdf text-danger' : 'fa-image text-muted'}"></i>
                        <span style="font-size: 9px;">${att.categoria_pago || 'Ver'}</span>
                    </a>
                `;
            });
            attachmentsHtml += `</div>`;
        }

        list.innerHTML += `
            <tr class="attachment-row border-bottom">
                <td class="ps-3 py-2">
                    <div class="text-muted fw-bold">${formatDateOnly(p.fecha_hora_pago)}</div>
                    ${attachmentsHtml}
                </td>
                <td class="py-2">${p.modo_pago || '-'}</td>
                <td class="py-2 fw-bold text-success">S/ ${formatCurrency(p.monto)}</td>
                <td class="text-end pe-3 py-2">
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCorpPayment('${p.name}', '${expenseId}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

function openPaymentModal() {
    document.getElementById('paymentForm').reset();
    document.getElementById('payDate').valueAsDate = new Date();

    if (currentHistoryExpense) {
        const total = parseFloat(currentHistoryExpense.monto || 0);
        const paid = (currentHistoryExpense.pagos || []).reduce((s, p) => s + parseFloat(p.monto || 0), 0);
        document.getElementById('payAmount').value = Math.max(0, total - paid).toFixed(2);

        if (currentHistoryExpense.orden_compra) {
            document.getElementById('erpMappingFields').classList.remove('d-none');
        } else {
            document.getElementById('erpMappingFields').classList.add('d-none');
        }
    }

    currentPaymentAttachments = [];
    renderPaymentAttachmentsManager();

    // Switch Modals
    closePaymentsHistory(true); // close visual only
    document.getElementById('paymentModal').classList.add('active');
    pushModalState();
}

function closePaymentModal(fromHistory = false) {
    document.getElementById('paymentModal').classList.remove('active');
    // reopen history
    if (currentSelectedId) {
        openPaymentsHistory({ stopPropagation: () => { } }, currentSelectedId);
    }
}

document.getElementById('paymentForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Registrando...';

    const args = {
        expense_name: currentSelectedId,
        monto: document.getElementById('payAmount').value,
        fecha: document.getElementById('payDate').value,
        modo_pago: document.getElementById('payMethod').value,
        modo_pago_compra: document.getElementById('payMethodERP').value,
        cuenta_de_banco: document.getElementById('payBankAccountERP').value
    };

    uploadPaymentAttachmentsSequentially(currentPaymentAttachments).then(finalAtts => {
        args.adjuntos = JSON.stringify(finalAtts);

        frappe.call({
            method: "finhub.www.finanzas_corporativas.index.create_payment",
            args: args,
            callback: r => {
                btn.disabled = false;
                btn.textContent = 'Registrar';
                if (r.message.status === 'success') {
                    frappe.show_alert('Pago Registrado', 'green');
                    closePaymentModal();
                    loadExpenses(); // Refresh List UI to update progress bar immediately
                } else {
                    frappe.msgprint('Error al guardar pago.');
                }
            }
        });
    });
});

function deleteCorpPayment(paymentId, expenseId) {
    frappe.confirm('¿Seguro de anular este pago?', () => {
        frappe.call({
            method: "finhub.www.finanzas_corporativas.index.delete_payment",
            args: { payment_name: paymentId, expense_name: expenseId },
            callback: function (r) {
                if (r.message.status === 'success') {
                    frappe.show_alert('Pago Eliminado');
                    loadExpenses();
                    closePaymentsHistory(); // force reload UI cleanly
                }
            }
        });
    });
}

// ----------------------------------------------------
// SHARED UTILS
// ----------------------------------------------------
function formatCurrency(amount) {
    return parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateOnly(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// Attachments logic for modal (Reused)
function triggerManualUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            prepareAttachmentUpload(file);
        }
    };
    input.click();
}
window.handlePasteButton = async function () {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const type = item.types.find(t => t.startsWith('image/'));
            if (type) {
                const blob = await item.getType(type);
                const paymentModalActive = document.getElementById('paymentModal').classList.contains('active');
                if (paymentModalActive) {
                    currentPaymentAttachments.push({
                        file: blob,
                        blobUrl: URL.createObjectURL(blob),
                        categoria: (paymentCategories && paymentCategories.length > 0) ? paymentCategories[0] : 'Comprobante'
                    });
                    renderPaymentAttachmentsManager();
                    frappe.show_alert({ message: 'Archivo pegado', indicator: 'blue' });
                } else {
                    prepareAttachmentUpload(blob);
                }
                return;
            }
        }
        frappe.msgprint('No se encontró ninguna imagen.');
    } catch (err) {
        frappe.msgprint('Acceso al portapapeles denegado. Use Ctrl+V.');
    }
};

let tempBlob = null;
let tempFileName = null;
function prepareAttachmentUpload(blobOrFile) {
    console.log("Preparing upload for type:", blobOrFile.type, "Name:", blobOrFile.name);
    tempBlob = blobOrFile;
    // Preserve original filename with extension; generate name with correct extension for blobs
    if (blobOrFile.name) {
        tempFileName = blobOrFile.name;
    } else {
        const blobType = (blobOrFile.type || '').toLowerCase();
        let ext = '.png';
        if (blobType.includes('pdf')) ext = '.pdf';
        else if (blobType.includes('jpeg') || blobType.includes('jpg')) ext = '.jpg';
        else if (blobType.includes('webp')) ext = '.webp';
        tempFileName = `attach-${new Date().getTime()}${ext}`;
    }

    const isPdf = blobOrFile.type && blobOrFile.type.toLowerCase().includes('pdf');
    const previewImg = document.getElementById('attachmentPreviewImg');
    const previewPdf = document.getElementById('attachmentPreviewPdf');
    const previewName = document.getElementById('attachmentPreviewName');

    if (isPdf) {
        previewImg.classList.add('d-none');
        previewPdf.classList.remove('d-none');
        previewName.textContent = tempFileName;

        document.getElementById('attachmentCategorySelect').value = '';
        document.getElementById('attachmentCategoryModal').classList.add('active');
        pushModalState();
    } else {
        previewImg.classList.remove('d-none');
        previewPdf.classList.add('d-none');

        const reader = new FileReader();
        reader.onload = function (e) {
            previewImg.src = e.target.result;
            document.getElementById('attachmentCategorySelect').value = '';
            document.getElementById('attachmentCategoryModal').classList.add('active');
            pushModalState();
        };
        reader.readAsDataURL(blobOrFile);
    }
}
window.closeAttachmentModal = function (fromHistory = false) {
    document.getElementById('attachmentCategoryModal').classList.remove('active');
    tempBlob = null;
}
window.confirmAttachment = function () {
    const cat = document.getElementById('attachmentCategorySelect').value;
    if (!cat) return frappe.msgprint('Seleccione una categoría');
    processUpload(tempBlob, cat);
    closeAttachmentModal();
}
async function processUpload(blob, category) {
    console.log("Processing upload:", blob.type, "Name:", blob.name, "tempFileName:", tempFileName);
    frappe.show_alert({ message: 'Subiendo...', indicator: 'orange' });

    // Use original file name if available, otherwise generate one
    let finalName = blob.name || tempFileName || `attach-${new Date().getTime()}`;

    // Map of known extensions to MIME types
    const extToMime = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'
    };
    const mimeToExt = {
        'application/pdf': '.pdf',
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp'
    };

    // Get extension from filename
    const nameMatch = finalName.match(/\.([^/.]+)$/);
    const extFromName = nameMatch ? '.' + nameMatch[1].toLowerCase() : '';

    // Get extension from MIME type
    const blobType = (blob.type || '').toLowerCase();
    const extFromMime = mimeToExt[blobType] || '';

    // Determine final extension: prefer filename, then MIME, then default .png
    let finalExt;
    if (extFromName && extToMime[extFromName]) {
        finalExt = extFromName;
    } else if (extFromMime) {
        finalExt = extFromMime;
    } else {
        finalExt = '.png';
    }

    // Ensure filename has correct extension
    if (!finalName.toLowerCase().endsWith(finalExt)) {
        finalName = finalName.replace(/\.[^/.]+$/, '') + finalExt;
    }

    // Ensure MIME type matches the extension
    const finalMime = extToMime[finalExt] || blob.type || 'application/octet-stream';

    console.log("Upload:", finalName, "MIME:", finalMime);

    // Add timestamp to filename to avoid Frappe deduplication returning old wrong file_url
    const baseName = finalName.replace(/\.[^/.]+$/, '');
    const uniqueName = `${baseName}_${Date.now()}${finalExt}`;

    const file = new File([blob], uniqueName, { type: finalMime });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('file_name', uniqueName);
    formData.append('is_private', 0);
    try {
        const response = await fetch('/api/method/upload_file', {
            method: 'POST',
            headers: { 'X-Frappe-CSRF-Token': frappe.csrf_token },
            body: formData
        });
        const resData = await response.json();
        if (resData.message && resData.message.file_url) {
            let fileUrl = resData.message.file_url;

            // Fix extension mismatch (Frappe dedup can return old wrong extension)
            const returnedExt = (fileUrl.match(/\.[^/.]+$/) || [''])[0].toLowerCase();
            if (returnedExt !== finalExt) {
                console.log("Extension mismatch! returned:", returnedExt, "expected:", finalExt, "- fixing...");
                const fixRes = await frappe.call({
                    method: "finhub.www.finanzas_corporativas.index.fix_file_extension",
                    args: { file_url: fileUrl, correct_ext: finalExt }
                });
                if (fixRes && fixRes.message && fixRes.message.file_url) {
                    fileUrl = fixRes.message.file_url;
                }
            }

            currentCorpAttachments.push({ file_url: fileUrl, category: category });
            renderAttachmentsListCorp();
            frappe.show_alert({ message: 'Archivo listo', indicator: 'green' });
        }
    } catch (err) { console.error("Upload error:", err); }
}

let currentPaymentAttachments = [];
function triggerPaymentFileSelect() { document.getElementById('hiddenPaymentFileInput').click(); }
function handlePaymentFileSelect(input) {
    if (!input.files.length) return;
    Array.from(input.files).forEach(file => {
        currentPaymentAttachments.push({
            file: file,
            blobUrl: URL.createObjectURL(file),
            categoria: paymentCategories[0] || 'Comprobante'
        });
    });
    input.value = '';
    renderPaymentAttachmentsManager();
}
function removePaymentAttachment(index) {
    currentPaymentAttachments.splice(index, 1);
    renderPaymentAttachmentsManager();
}
function updatePaymentAttachmentCategory(index, value) {
    currentPaymentAttachments[index].categoria = value;
}
function renderPaymentAttachmentsManager() {
    const list = document.getElementById('paymentAttachmentsList');
    list.innerHTML = '';
    if (currentPaymentAttachments.length === 0) {
        list.innerHTML = '<p class="text-muted small text-center py-3 m-0 fst-italic">No hay documentos adjuntos</p>';
        return;
    }
    currentPaymentAttachments.forEach((att, idx) => {
        const item = document.createElement('div');
        item.className = 'd-flex align-items-center gap-2 p-2 border rounded bg-white shadow-sm';
        item.innerHTML = `
            <div style="width: 40px; height: 40px; border-radius: 4px; overflow: hidden; background: #f0f0f0;" class="flex-shrink-0">
                ${att.file && att.file.name.toLowerCase().endsWith('.pdf') ? `<div class="w-100 h-100 d-flex align-items-center justify-content-center"><i class="fas fa-file-pdf text-danger"></i></div>` : `<img src="${att.blobUrl}" style="width: 100%; height: 100%; object-fit: cover;">`}
            </div>
            <div class="flex-grow-1">
                <select class="form-select form-select-sm border-0 bg-transparent p-0 fw-bold custom-select-att" onchange="updatePaymentAttachmentCategory(${idx}, this.value)">
                    ${paymentCategories.map(c => `<option value="${c}" ${att.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
                <div class="text-muted" style="font-size: 10px; max-width: 150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">NUEVO: ${att.file ? att.file.name : ''}</div>
            </div>
            <button type="button" class="btn btn-sm text-danger border-0 p-1" onclick="removePaymentAttachment(${idx})"><i class="fas fa-times"></i></button>
        `;
        list.appendChild(item);
    });
}
async function uploadPaymentAttachmentsSequentially(attArray) {
    const uploadedData = [];
    for (const att of attArray) {
        if (att.file) {
            const formData = new FormData();

            // Determine name and extension
            let name = att.file.name;
            if (!name || name === 'blob') {
                let ext = '.png';
                if (att.file.type === 'application/pdf') ext = '.pdf';
                name = `pago-${new Date().getTime()}${ext}`;
            }

            formData.append('file', att.file, name);
            formData.append('is_private', 0);
            try {
                const req = await fetch('/api/method/upload_file', {
                    method: 'POST',
                    headers: { 'X-Frappe-CSRF-Token': frappe.csrf_token },
                    body: formData
                });
                const res = await req.json();
                if (res.message && res.message.file_url) {
                    uploadedData.push({ archivo: res.message.file_url, categoria: att.categoria });
                }
            } catch (e) { }
        }
    }
    return uploadedData;
}

// Global Modal State Management
function pushModalState() {
    if (!isModalPushed) {
        window.history.pushState({ modal: true }, "");
        isModalPushed = true;
    }
}

function clearModalState() {
    if (isModalPushed) {
        isModalPushed = false;
        window.history.back();
    }
}

// --- Quick Create Logic ---

window.quickCreateCategory = function () {
    openQuickCreate('Nueva Categoría de Gasto', 'category');
};

window.quickDeleteCategory = function () {
    const catSelect = document.getElementById('inputCategoria');
    const selectedName = catSelect.value;

    if (!selectedName) {
        return frappe.msgprint('Seleccione una categoría para eliminar');
    }

    frappe.confirm(`¿Está seguro de eliminar la categoría "${selectedName}"?`, () => {
        frappe.call({
            method: "finhub.www.finanzas_corporativas.index.delete_category",
            args: { name: selectedName },
            callback: function (r) {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert(r.message.message, 'green');

                    // Update local data
                    categoriesData = categoriesData.filter(c => c.name !== selectedName);

                    // Update dropdowns
                    const catSelect = document.getElementById('inputCategoria');
                    const quickVarCat = document.getElementById('qVarCategory');

                    if (catSelect) {
                        for (let i = 0; i < catSelect.options.length; i++) {
                            if (catSelect.options[i].value === selectedName) {
                                catSelect.remove(i);
                                break;
                            }
                        }
                        catSelect.value = '';
                        catSelect.dispatchEvent(new Event('change'));
                    }

                    if (quickVarCat) {
                        for (let i = 0; i < quickVarCat.options.length; i++) {
                            if (quickVarCat.options[i].value === selectedName) {
                                quickVarCat.remove(i);
                                break;
                            }
                        }
                    }
                } else {
                    frappe.msgprint(r.message ? r.message.message : 'Error al eliminar la categoría');
                }
            }
        });
    });
};

window.quickCreatePaymentMethod = function () {
    openQuickCreate('Nuevo Método de Pago', 'payment_method');
};

window.quickCreatePayCategory = function () {
    openQuickCreate('Nueva Categoría de Pago', 'payment_category');
};

window.quickCreateAttachmentCategory = function () {
    openQuickCreate('Nueva Categoría de Adjunto', 'attachment_category');
    document.getElementById('attachmentCategoryModal').classList.remove('active');
}

window.openQuickCreate = function (title, type) {
    document.getElementById('quickCreateTitle').textContent = title;
    document.getElementById('quickCreateType').value = type;
    document.getElementById('quickCreateInput').value = '';

    const extra = document.getElementById('quickCreateExtraFields');
    if (extra) {
        extra.innerHTML = '';
        if (type === 'category') {
            extra.innerHTML = `
                <div class="form-group">
                    <label>Tipo de Gasto</label>
                    <select id="quickCreateSelect" class="form-select">
                        <option value="Variable">Variable</option>
                        <option value="Fijo">Fijo</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Icono (imagen, opcional)</label>
                    <input type="file" id="quickCreateCatImage" accept="image/*" class="form-control">
                    <small class="text-muted">PNG, JPG o SVG.</small>
                </div>
                <div class="form-group">
                    <label>Icono (elegir de lista)</label>
                    <div id="quickCreateCatIconPicker" class="fc-icon-picker"></div>
                    <small class="text-muted d-block mt-1">Opcional. Solo aplica si no se sube imagen.</small>
                </div>
                <div class="form-group">
                    <label>Color</label>
                    <div class="d-flex align-items-center gap-2">
                        <input type="color" id="quickCreateCatColor" class="form-control form-control-color" value="#4f46e5" style="width: 64px; height: 40px;">
                        <span class="text-muted small" id="quickCreateCatColorValue">#4f46e5</span>
                    </div>
                </div>
            `;
            const colorEl = document.getElementById('quickCreateCatColor');
            const colorVal = document.getElementById('quickCreateCatColorValue');
            if (colorEl && colorVal) {
                colorEl.addEventListener('input', () => colorVal.textContent = colorEl.value);
            }
            const pickerEl = document.getElementById('quickCreateCatIconPicker');
            window._fcQuickCreatePickedIcon = '';
            fcBuildIconPicker(pickerEl, '', (ic) => {
                window._fcQuickCreatePickedIcon = ic;
            });
        }
    }

    document.getElementById('quickCreateModal').classList.add('active');
    setTimeout(() => {
        const input = document.getElementById('quickCreateInput');
        if (input) input.focus();
    }, 100);
}

window.closeQuickCreate = function () {
    document.getElementById('quickCreateModal').classList.remove('active');
}

// ============================================================
// WIZARD ENGINE (Detalle Gasto + Nuevo Proveedor)
// ============================================================

const WIZARD_EXPENSE = {
    rootSelector: '#expenseForm',
    indicatorClass: '.fc-wizard-step-indicator',
    paneClass: '.fc-wizard-pane',
    backBtnId: 'fcWizardBackBtn',
    nextBtnId: 'fcWizardNextBtn',
    saveBtnId: 'btnSave',
    progressId: 'fcWizardProgress',
    currentStep: 1,
    totalSteps: 4,
    editMode: false,
    validateStep(n) {
        if (n === 1) {
            return fcRequireFields([
                ['inputFecha', 'Fecha del gasto'],
                ['inputMonto', 'Monto'],
                ['inputCategoria', 'Categoria']
            ]);
        }
        if (n === 3) {
            const venc = document.getElementById('toggleVencimiento');
            if (venc && venc.checked) {
                return fcRequireFields([['inputVencimiento', 'Fecha de vencimiento']]);
            }
        }
        return true;
    }
};

const WIZARD_SUPPLIER = {
    rootSelector: '#formNewSupplier',
    indicatorClass: '.fcs-wizard-step-indicator',
    paneClass: '.fcs-wizard-pane',
    backBtnId: 'fcsWizardBackBtn',
    nextBtnId: 'fcsWizardNextBtn',
    saveBtnId: 'btnSaveNewSupp',
    progressId: 'fcsWizardProgress',
    currentStep: 1,
    totalSteps: 2,
    editMode: false,
    validateStep(n) {
        if (n === 1) {
            return fcRequireFields([
                ['newSuppRuc', 'RUC / DNI'],
                ['newSuppName', 'Nombre / Razon Social']
            ]);
        }
        return true;
    }
};

function fcRequireFields(fields) {
    let ok = true;
    let firstMissing = null;
    fields.forEach(([id, label]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const value = (el.value || '').trim();
        if (!value) {
            el.classList.add('is-invalid');
            ok = false;
            if (!firstMissing) firstMissing = { el, label };
        } else {
            el.classList.remove('is-invalid');
        }
    });
    if (!ok && firstMissing) {
        frappe.show_alert({ message: `Falta completar: ${firstMissing.label}`, indicator: 'red' });
        try { firstMissing.el.focus({ preventScroll: false }); } catch (e) { }
    }
    return ok;
}

function fcWizardRender(W) {
    const root = document.querySelector(W.rootSelector);
    if (!root) return;

    root.querySelectorAll(W.indicatorClass).forEach(el => {
        const step = parseInt(el.dataset.step, 10);
        el.classList.toggle('active', step === W.currentStep);
        el.classList.toggle('done', step < W.currentStep);
        if (step === W.currentStep) el.setAttribute('aria-current', 'step');
        else el.removeAttribute('aria-current');
    });

    root.querySelectorAll(W.paneClass).forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.step, 10) === W.currentStep);
    });

    const backBtn = document.getElementById(W.backBtnId);
    const nextBtn = document.getElementById(W.nextBtnId);
    const saveBtn = document.getElementById(W.saveBtnId);
    const progress = document.getElementById(W.progressId);
    const isLast = W.currentStep === W.totalSteps;

    if (backBtn) backBtn.style.display = W.currentStep > 1 ? 'inline-flex' : 'none';
    if (nextBtn) nextBtn.style.display = isLast ? 'none' : 'inline-flex';
    if (saveBtn) saveBtn.style.display = isLast ? 'inline-flex' : 'none';
    if (progress) progress.textContent = `Paso ${W.currentStep} de ${W.totalSteps}`;

    setTimeout(() => {
        const pane = root.querySelector(`${W.paneClass}.active`);
        if (!pane) return;
        const inp = pane.querySelector('input:not([type=hidden]):not([readonly]):not(:disabled), select:not(:disabled), textarea:not(:disabled)');
        if (inp) try { inp.focus({ preventScroll: true }); } catch (e) { }
    }, 60);
}

function fcWizardReset(W, editMode) {
    W.currentStep = 1;
    W.editMode = !!editMode;
    fcWizardRender(W);
}

window.fcWizardNext = function () {
    if (!WIZARD_EXPENSE.validateStep(WIZARD_EXPENSE.currentStep)) return;
    if (WIZARD_EXPENSE.currentStep < WIZARD_EXPENSE.totalSteps) {
        WIZARD_EXPENSE.currentStep += 1;
        fcWizardRender(WIZARD_EXPENSE);
    }
};
window.fcWizardPrev = function () {
    if (WIZARD_EXPENSE.currentStep > 1) {
        WIZARD_EXPENSE.currentStep -= 1;
        fcWizardRender(WIZARD_EXPENSE);
    }
};
window.fcWizardGoTo = function (step) {
    if (step === WIZARD_EXPENSE.currentStep) return;
    if (WIZARD_EXPENSE.editMode || step < WIZARD_EXPENSE.currentStep) {
        WIZARD_EXPENSE.currentStep = step;
        fcWizardRender(WIZARD_EXPENSE);
        return;
    }
    for (let s = WIZARD_EXPENSE.currentStep; s < step; s++) {
        if (!WIZARD_EXPENSE.validateStep(s)) return;
    }
    WIZARD_EXPENSE.currentStep = step;
    fcWizardRender(WIZARD_EXPENSE);
};

window.fcsWizardNext = function () {
    if (!WIZARD_SUPPLIER.validateStep(WIZARD_SUPPLIER.currentStep)) return;
    if (WIZARD_SUPPLIER.currentStep < WIZARD_SUPPLIER.totalSteps) {
        WIZARD_SUPPLIER.currentStep += 1;
        fcWizardRender(WIZARD_SUPPLIER);
    }
};
window.fcsWizardPrev = function () {
    if (WIZARD_SUPPLIER.currentStep > 1) {
        WIZARD_SUPPLIER.currentStep -= 1;
        fcWizardRender(WIZARD_SUPPLIER);
    }
};
window.fcsWizardGoTo = function (step) {
    if (step === WIZARD_SUPPLIER.currentStep) return;
    if (WIZARD_SUPPLIER.editMode || step < WIZARD_SUPPLIER.currentStep) {
        WIZARD_SUPPLIER.currentStep = step;
        fcWizardRender(WIZARD_SUPPLIER);
        return;
    }
    for (let s = WIZARD_SUPPLIER.currentStep; s < step; s++) {
        if (!WIZARD_SUPPLIER.validateStep(s)) return;
    }
    WIZARD_SUPPLIER.currentStep = step;
    fcWizardRender(WIZARD_SUPPLIER);
};

document.addEventListener('DOMContentLoaded', () => {
    fcWizardRender(WIZARD_EXPENSE);
    fcWizardRender(WIZARD_SUPPLIER);

    ['inputFecha', 'inputMonto', 'inputCategoria', 'inputVencimiento', 'newSuppRuc', 'newSuppName'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => el.classList.remove('is-invalid'));
        if (el && el.tagName === 'SELECT') el.addEventListener('change', () => el.classList.remove('is-invalid'));
    });

    // Category appearance modal handlers
    const apprImg = document.getElementById('catApprImageInput');
    const apprClear = document.getElementById('catApprImageClear');
    const apprIconClear = document.getElementById('catApprIconClear');
    const apprColor = document.getElementById('catApprColor');
    const apprColorVal = document.getElementById('catApprColorValue');
    const apprPreview = document.getElementById('catApprPreview');

    if (apprImg) {
        apprImg.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            FC_APPR_NEW_FILE = f;
            FC_APPR_PENDING_IMAGE = null;
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (apprPreview) apprPreview.innerHTML = `<img src="${ev.target.result}" alt="">`;
            };
            reader.readAsDataURL(f);
        });
    }
    if (apprClear) {
        apprClear.addEventListener('click', () => {
            FC_APPR_NEW_FILE = null;
            FC_APPR_PENDING_IMAGE = '';
            if (apprImg) apprImg.value = '';
            fcApprRefreshPreview();
        });
    }
    if (apprIconClear) {
        apprIconClear.addEventListener('click', () => {
            FC_APPR_PENDING_ICON = '';
            const pickerEl = document.getElementById('catApprIconPicker');
            if (pickerEl) pickerEl.querySelectorAll('.fc-icon-pick-btn').forEach(b => b.classList.remove('active'));
            fcApprRefreshPreview();
        });
    }
    if (apprColor && apprColorVal) {
        apprColor.addEventListener('input', () => {
            apprColorVal.textContent = apprColor.value;
            if (apprPreview) apprPreview.style.setProperty('--cat-color', apprColor.value);
        });
    }

    // Mobile tabs
    let savedTab = 'fijo';
    try { savedTab = localStorage.getItem('fcMobileTab') || 'fijo'; } catch (e) { }
    if (savedTab !== 'variable') savedTab = 'fijo';
    fcApplyMobileTab(savedTab);

    document.querySelectorAll('.fc-mobile-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            fcApplyMobileTab(btn.dataset.tab);
        });
    });
});

document.addEventListener("DOMContentLoaded", () => {
    const qForm = document.getElementById('quickCreateForm');
    if (qForm) {
        qForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const type = document.getElementById('quickCreateType').value;
            const name = document.getElementById('quickCreateInput').value;

            if (!name) return;

            if (type === 'payment_category') {
                frappe.call({
                    method: "frappe.client.insert",
                    args: {
                        doc: {
                            doctype: "Categoria Pago",
                            nombre: name,
                            is_group: 0
                        }
                    },
                    callback: function (r) {
                        if (!r.exc) {
                            frappe.show_alert('Categoría de Pago creada');
                            if (!paymentCategories.includes(name)) paymentCategories.push(name);
                            updateAttachmentCategorySelect();
                            renderPaymentAttachmentsManager();
                            closeQuickCreate();
                        }
                    }
                });
            }
            else if (type === 'attachment_category') {
                frappe.call({
                    method: "finhub.www.finanzas_corporativas.index.create_attachment_category",
                    args: { name: name },
                    callback: function (r) {
                        if (r.message && r.message.status === 'success') {
                            const newCat = r.message.data.name;
                            attachmentCategories.push(newCat);
                            updateAttachmentCategorySelect();

                            if (tempBlob) {
                                document.getElementById('attachmentCategoryModal').classList.add('active');
                                document.getElementById('attachmentCategorySelect').value = newCat;
                            }
                            frappe.show_alert('Categoría creada');
                            closeQuickCreate();
                        } else {
                            frappe.msgprint(r.message ? r.message.message : 'Error al crear');
                        }
                    }
                });
            }
            else if (type === 'category') {
                const tipoGasto = document.getElementById('quickCreateSelect').value;
                const imgInput = document.getElementById('quickCreateCatImage');
                const colorEl = document.getElementById('quickCreateCatColor');
                const color = colorEl ? colorEl.value : null;
                const file = (imgInput && imgInput.files && imgInput.files[0]) || null;

                const pickedIcon = window._fcQuickCreatePickedIcon || null;

                (async () => {
                    let iconUrl = null;
                    try {
                        if (file) {
                            iconUrl = await uploadCategoryIcon(file);
                        }
                    } catch (err) {
                        frappe.show_alert({ message: 'Error al subir imagen: ' + (err.message || err), indicator: 'red' });
                        return;
                    }

                    frappe.call({
                        method: "finhub.www.finanzas_corporativas.index.create_category",
                        args: {
                            name: name,
                            tipo: tipoGasto,
                            icono_imagen: iconUrl,
                            icono: pickedIcon,
                            color: color
                        },
                        callback: function (r) {
                            if (r.message && r.message.status === 'success') {
                                const newCat = r.message.data;
                                categoriesData.push({
                                    name: newCat.name,
                                    tipo_gasto: newCat.tipo_gasto,
                                    icono_imagen: newCat.icono_imagen,
                                    icono: newCat.icono,
                                    color: newCat.color
                                });

                                const catSelect = document.getElementById('inputCategoria');
                                if (catSelect) {
                                    const opt = document.createElement('option');
                                    opt.value = newCat.name;
                                    opt.textContent = newCat.name;
                                    catSelect.appendChild(opt);
                                    catSelect.value = newCat.name;
                                    catSelect.dispatchEvent(new Event('change'));
                                }

                                frappe.show_alert('Categoría creada');
                                closeQuickCreate();
                                if (window.lastLoadedExpenses) renderDashboardLayout(window.lastLoadedExpenses);
                            } else {
                                frappe.msgprint(r.message ? r.message.message : 'Error al crear');
                            }
                        }
                    });
                })();
            }
            else if (type === 'payment_method') {
                frappe.call({
                    method: "finhub.www.finanzas_corporativas.index.create_payment_method",
                    args: { name: name },
                    callback: function (r) {
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert('Método de Pago creado');
                            const paySelect = document.getElementById('inputMetodoPago');
                            const payMethodModal = document.getElementById('payMethod');

                            [paySelect, payMethodModal].forEach(sel => {
                                if (sel) {
                                    const opt = document.createElement('option');
                                    opt.value = name;
                                    opt.textContent = name;
                                    sel.appendChild(opt);
                                }
                            });

                            if (payMethodModal) payMethodModal.value = name;
                            if (paySelect && !payMethodModal) paySelect.value = name;

                            closeQuickCreate();
                        } else {
                            frappe.msgprint(r.message ? r.message.message : 'Error al crear');
                        }
                    }
                });
            }
            else {
                frappe.msgprint('Tipo de creación no validado: ' + type);
            }
        });
    }
});
