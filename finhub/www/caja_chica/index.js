document.addEventListener("DOMContentLoaded", () => {
    // Default dates (First to Last day of month)
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    document.getElementById('filterStartDate').value = firstDay.toISOString().split('T')[0];
    document.getElementById('filterEndDate').value = lastDay.toISOString().split('T')[0];

    loadInitialData();
    loadCajas();

    // Search and Filters
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadCajas, 400);
    });

    document.getElementById('filterStartDate').addEventListener('change', loadCajas);
    document.getElementById('filterEndDate').addEventListener('change', loadCajas);
    document.getElementById('filterStatus').addEventListener('change', loadCajas);

    // Form Submissions
    document.getElementById('cajaForm').addEventListener('submit', handleCajaSubmit);

    const pForm = document.getElementById('paymentForm');
    if (pForm) pForm.addEventListener('submit', handlePaymentSubmit);

    // ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDetailPane();
            closePaymentsHistory();
            if (typeof closePaymentModal === 'function') closePaymentModal();
            if (typeof closePaymentDetailModal === 'function') closePaymentDetailModal();
            if (typeof closeAttachmentModal === 'function') closeAttachmentModal();
            if (typeof closeQuickCreateModal === 'function') closeQuickCreateModal();
        }
    });

    // Back button support
    window.addEventListener('popstate', (e) => {
        closeAllModals(true);
    });

    // Handle state on load
    if (window.history.state && window.history.state.modal) {
        window.history.replaceState(null, "");
    }
});

let isModalPushed = false;
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

function closeAllModals(fromHistory = false) {
    closeDetailPane(fromHistory);
    closePaymentsHistory(fromHistory);
    closePaymentModal(fromHistory);
    closePaymentDetailModal(fromHistory);
    closeAttachmentModal(fromHistory);
    closeQuickCreateModal(fromHistory);
}

let paymentMethods = [];
let usersList = [];
let attachmentCategories = [];
let paymentCategories = [];
let currentAttachments = [];
let currentPaymentAttachments = [];
let currentSelectedCajaId = null;
let attachmentTarget = 'caja'; // 'caja' or 'payment'

function loadInitialData() {
    frappe.call({
        method: "finhub.www.caja_chica.index.get_initial_data",
        callback: (r) => {
            if (r.message && !r.message.status) {
                paymentMethods = r.message.payment_methods || [];
                usersList = r.message.users || [];
                attachmentCategories = r.message.attachment_categories || [];
                paymentCategories = r.message.payment_categories || [];

                // Populate Responsable Select
                const respSelect = document.getElementById('inputResponsable');
                if (respSelect) {
                    const currentVal = respSelect.value;
                    respSelect.innerHTML = '<option value="">Seleccione encargado...</option>';
                    usersList.forEach(u => {
                        const opt = document.createElement('option');
                        opt.value = u.name;
                        opt.textContent = u.full_name || u.name;
                        respSelect.appendChild(opt);
                    });
                    if (currentVal) respSelect.value = currentVal;
                }

                // Attachment Categories populated dynamically in prepareAttachmentUpload

                // Populate Payment Methods
                const modoSel = document.getElementById('pInputModo');
                if (modoSel) {
                    const currentVal = modoSel.value;
                    modoSel.innerHTML = '<option value="">Seleccione pago...</option>';
                    paymentMethods.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m;
                        opt.textContent = m;
                        modoSel.appendChild(opt);
                    });
                    if (currentVal) modoSel.value = currentVal;
                }

                // Populate Payment Categories (pInputCategoria)
                const catSel = document.getElementById('pInputCategoria');
                if (catSel) {
                    const currentVal = catSel.value;
                    catSel.innerHTML = '<option value="">Seleccione categoría...</option>';
                    paymentCategories.forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c;
                        opt.textContent = c;
                        catSel.appendChild(opt);
                    });
                    if (currentVal) catSel.value = currentVal;
                }

                // Initial Stats
                if (r.message.stats) {
                    updateGlobalStats(r.message.stats);
                }
            }
        }
    });
}

function loadCajas() {
    const filters = {
        estado: document.getElementById('filterStatus').value,
        start_date: document.getElementById('filterStartDate').value,
        end_date: document.getElementById('filterEndDate').value,
        search: document.getElementById('searchInput').value
    };

    frappe.call({
        method: "finhub.www.caja_chica.index.get_caja_list",
        args: { filters: JSON.stringify(filters) },
        callback: (r) => {
            if (r.message) {
                renderCajas(r.message);
                updateStats(r.message);
            }
        }
    });
}

function renderCajas(cajas) {
    const container = document.getElementById('cajaList');
    container.innerHTML = '';

    if (!cajas || cajas.length === 0) {
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="text-muted mb-3"><i class="fas fa-folder-open fa-3x"></i></div>
                <h6 class="fw-bold">No se encontraron registros</h6>
                <p class="small text-muted">Intenta cambiar los filtros o realiza una nueva búsqueda.</p>
            </div>`;
        return;
    }

    cajas.forEach(c => {
        const totalSpent = (c.pagos || []).reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
        const percentUsed = Math.min(100, (totalSpent / (c.monto || 1)) * 100);
        const isLow = percentUsed > 90;

        const card = document.createElement('div');
        card.className = `caja-card ${currentSelectedCajaId === c.name ? 'selected' : ''}`;
        card.onclick = () => showCajaDetail(c);

        card.innerHTML = `
            <div class="caja-header">
                <div>
                    <span class="caja-name">${c.name}</span>
                    <span class="caja-date">${formatDate(c.fecha)}</span>
                </div>
                <span class="status-badge ${c.estado === 'Abierta' ? 'status-open' : 'status-closed'}" 
                      ${c.estado === 'Abierta' ? `onclick="event.stopPropagation(); confirmCloseCaja('${c.name}')"` : ''}
                      ${c.estado === 'Abierta' ? 'style="cursor: pointer;"' : ''}>
                    ${c.estado}
                </span>
            </div>
            
            <div class="d-flex align-items-center gap-3 mb-3">
                <div class="caja-icon"><i class="fas fa-cash-register"></i></div>
                <div class="flex-grow-1">
                    <small class="text-muted d-block" style="font-size: 11px;">Responsable</small>
                    <span class="fw-bold small">${c.responsable_name || c.responsable || 'Sin asignar'}</span>
                </div>
            </div>

            <div class="caja-amounts">
                <div class="amount-group">
                    <span class="amount-label">Disponible</span>
                    <span class="amount-value text-success">S/ ${formatCurrency(c.saldo_restante)}</span>
                </div>
                <div class="amount-group text-end">
                    <span class="amount-label">Inicial</span>
                    <span class="amount-value muted">S/ ${formatCurrency(c.monto)}</span>
                </div>
            </div>

            <div class="progress-container">
                <div class="progress-labels">
                    <span>Uso del fondo</span>
                    <span class="${isLow ? 'text-danger' : 'text-primary'}">${Math.round(percentUsed)}%</span>
                </div>
                <div class="progress-bar-wrap">
                    <div class="progress-bar-fill ${isLow ? 'bg-danger' : ''}" style="width: ${percentUsed}%"></div>
                </div>
            </div>

            <div class="d-flex justify-content-end mt-4 pt-3 border-top">
                <button class="btn btn-primary w-100 rounded-3 px-3 py-2 fw-bold shadow-sm" style="font-size: 14px; background-color: #2563eb !important; border-color: #2563eb !important;" onclick="event.stopPropagation(); openPaymentsHistory('${c.name}')">
                    <i class="fas fa-receipt me-1"></i> Ver Pagos
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

function updateStats(cajas) {
    const openCajas = cajas.filter(c => c.estado === 'Abierta');
    const totalBalance = openCajas.reduce((sum, c) => sum + parseFloat(c.saldo_restante || 0), 0);

    const countElem = document.getElementById('openBoxesCount');
    const balanceElem = document.getElementById('totalAvailableBalance');

    if (countElem) countElem.textContent = openCajas.length;
    if (balanceElem) balanceElem.textContent = 'S/ ' + formatCurrency(totalBalance);

    // Fetch and update daily/monthly stats WITH FILTERS
    const statsFilters = {
        start_date: document.getElementById('filterStartDate').value,
        end_date: document.getElementById('filterEndDate').value
    };

    frappe.call({
        method: "finhub.www.caja_chica.index.get_summary_stats",
        args: { filters: JSON.stringify(statsFilters) },
        callback: (r) => {
            if (r.message) {
                updateGlobalStats(r.message);
            }
        }
    });
}

function updateGlobalStats(stats) {
    const todayElem = document.getElementById('totalSpentToday');
    const monthElem = document.getElementById('totalSpentMonth');

    if (todayElem) todayElem.textContent = 'S/ ' + formatCurrency(stats.total_hoy || 0);
    if (monthElem) monthElem.textContent = 'S/ ' + formatCurrency(stats.total_mes || 0);

    // Renderizar stats globales por categoría
    renderGlobalCategoryStats(stats.category_stats || []);
}

function renderGlobalCategoryStats(categoryStats) {
    const container = document.getElementById('globalCategoryStatsContainer');
    if (!container) return;

    if (!categoryStats || categoryStats.length === 0) {
        container.innerHTML = '';
        return;
    }

    const totalGastado = categoryStats.reduce((sum, c) => sum + c.total, 0);
    const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

    let html = `<div class="global-category-stats">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div class="d-flex align-items-center gap-2">
                <div class="stat-icon bg-primary-soft" style="width: 36px; height: 36px; border-radius: 10px; font-size: 16px;">
                    <i class="fas fa-chart-pie"></i>
                </div>
                <h6 class="fw-bold mb-0">Gasto por Categoría</h6>
            </div>
            <span class="text-muted small fw-bold">${categoryStats.length} categoría${categoryStats.length > 1 ? 's' : ''} &middot; S/ ${formatCurrency(totalGastado)}</span>
        </div>
        <div class="global-category-grid">`;

    categoryStats.forEach((item, i) => {
        const percent = totalGastado > 0 ? (item.total / totalGastado * 100) : 0;
        const color = colors[i % colors.length];
        html += `
            <div class="global-category-card">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <span class="category-color-dot" style="background: ${color}"></span>
                    <span class="global-category-name">${item.categoria}</span>
                </div>
                <div class="global-category-amount">S/ ${formatCurrency(item.total)}</div>
                <div class="category-stat-bar mt-2">
                    <div class="category-stat-bar-fill" style="width: ${percent}%; background: ${color}"></div>
                </div>
                <span class="global-category-percent">${Math.round(percent)}%</span>
            </div>`;
    });

    html += `</div></div>`;
    container.innerHTML = html;
}

function openDetailPane() {
    const emptyState = document.getElementById('detail-empty');
    const detailContent = document.getElementById('detail-content');
    const pane = document.getElementById('right-pane');
    const overlay = document.getElementById('detailOverlay');

    if (emptyState) emptyState.classList.add('d-none');
    if (detailContent) detailContent.classList.remove('d-none');
    if (pane) pane.classList.add('active');
    if (overlay) overlay.classList.add('active');
    pushModalState();
}

function closeDetailPane(fromHistory = false) {
    const pane = document.getElementById('right-pane');
    const overlay = document.getElementById('detailOverlay');

    if (pane) pane.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    if (fromHistory) {
        isModalPushed = false;
    } else {
        clearModalState();
    }

    setTimeout(() => {
        const emptyState = document.getElementById('detail-empty');
        const detailContent = document.getElementById('detail-content');
        if (emptyState) emptyState.classList.remove('d-none');
        if (detailContent) detailContent.classList.add('d-none');
    }, 300);

    document.querySelectorAll('.caja-card').forEach(card => card.classList.remove('selected'));
    currentSelectedCajaId = null;
}

function openNewBox() {
    const form = document.getElementById('cajaForm');
    if (form) form.reset();

    const idInput = document.getElementById('cajaId');
    const title = document.getElementById('paneTitle');
    const btnDel = document.getElementById('btnDelete');
    const dateInput = document.getElementById('inputFecha');

    if (idInput) idInput.value = '';
    if (title) title.textContent = 'Nueva Caja Chica';
    if (btnDel) btnDel.classList.add('d-none');
    if (dateInput) dateInput.valueAsDate = new Date();

    currentAttachments = [];
    window._cchCurrentCaja = null;
    renderAttachmentsList();
    loadCajasConSaldo();
    openDetailPane();

    cchSwitchTab('caja');
    cchGDOnCajaOpen();
}

function loadCajasConSaldo() {
    const group = document.getElementById('saldoAnteriorGroup');
    const select = document.getElementById('inputCajaOrigen');
    const info = document.getElementById('saldoOrigenInfo');

    frappe.call({
        method: "finhub.www.caja_chica.index.get_cajas_con_saldo",
        callback: (r) => {
            select.innerHTML = '<option value="">— Sin arrastre —</option>';
            info.style.display = 'none';
            if (r.message && r.message.length) {
                r.message.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.name;
                    opt.textContent = `${c.name} — ${c.fecha} — Saldo: S/ ${parseFloat(c.saldo_restante).toFixed(2)}`;
                    opt.dataset.saldo = c.saldo_restante;
                    select.appendChild(opt);
                });
                group.style.display = '';
            } else {
                group.style.display = 'none';
            }
        }
    });

    select.onchange = () => {
        const selected = select.selectedOptions[0];
        if (selected && selected.value) {
            info.textContent = `Se añadirán S/ ${parseFloat(selected.dataset.saldo).toFixed(2)} al monto de esta caja`;
            info.style.display = '';
        } else {
            info.style.display = 'none';
        }
    };
}

function showCajaDetail(c) {
    currentSelectedCajaId = c.name;
    window._cchCurrentCaja = { name: c.name, estado: c.estado, saldo_restante: c.saldo_restante };
    document.getElementById('paneTitle').textContent = `Caja ${c.name}`;
    document.getElementById('btnDelete').classList.remove('d-none');
    document.getElementById('saldoAnteriorGroup').style.display = 'none';

    document.getElementById('cajaId').value = c.name;
    document.getElementById('inputFecha').value = c.fecha;
    document.getElementById('inputMonto').value = c.monto;
    document.getElementById('inputResponsable').value = c.responsable;
    document.getElementById('inputDescripcion').value = c.descripcion;
    document.getElementById('inputEstado').value = c.estado;

    currentAttachments = (c.adjuntos || []).map(a => ({ file_url: a.archivo, category: a.categoria }));
    renderAttachmentsList();
    openDetailPane();

    cchSwitchTab('caja');
    cchGDOnCajaOpen();

    document.querySelectorAll('.caja-card').forEach(card => {
        if (card.querySelector('.caja-name').textContent === c.name) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
}

function handleCajaSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSave');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

    const data = Object.fromEntries(new FormData(e.target).entries());
    data.adjuntos = currentAttachments.map(a => ({ categoria: a.category, archivo: a.file_url }));

    frappe.call({
        method: "finhub.www.caja_chica.index.save_caja",
        args: { data: JSON.stringify(data) },
        callback: (r) => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            if (r.message && r.message.status === 'success') {
                frappe.show_alert({ message: 'Caja Chica actualizada con éxito', indicator: 'green' });
                closeDetailPane();
                loadCajas();
            } else {
                frappe.msgprint({ title: 'Error', indicator: 'red', message: r.message ? r.message.message : 'Error al procesar la solicitud' });
            }
        }
    });
}

// --- Expenses History ---
let currentCajaForPayments = null;

window.openPaymentsHistory = (cajaName) => {
    currentCajaForPayments = cajaName;
    document.getElementById('phCajaTitle').textContent = `Serie: ${cajaName}`;

    frappe.call({
        method: "finhub.www.caja_chica.index.get_caja_details",
        args: { name: cajaName },
        callback: (r) => {
            if (r.message) {
                renderPaymentsHistoryList(r.message);
                document.getElementById('paymentsHistoryModal').classList.add('active');
                pushModalState();
            }
        }
    });
};

function renderPaymentsHistoryList(doc) {
    const list = document.getElementById('paymentsHistoryList');
    list.innerHTML = '';

    const montoCaja = parseFloat(doc.monto || 0);
    const saldo = parseFloat(doc.saldo_restante || 0);
    const gastado = montoCaja - saldo;

    document.getElementById('phTotal').textContent = `S/ ${formatCurrency(montoCaja)}`;
    document.getElementById('phSpent').textContent = `S/ ${formatCurrency(gastado)}`;
    document.getElementById('phBalance').textContent = `S/ ${formatCurrency(saldo)}`;

    if (doc.estado === 'Cerrada') {
        document.getElementById('btnAddExpense').classList.add('d-none');
    } else {
        document.getElementById('btnAddExpense').classList.remove('d-none');
    }

    if (!doc.pagos || doc.pagos.length === 0) {
        list.innerHTML = '<tr><td colspan="4" class="text-center py-5 text-muted">Sin gastos registrados</td></tr>';
        return;
    }

    const paymentIds = doc.pagos.map(p => p.serie).filter(id => id);
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Pago Finanzas P",
            filters: { name: ["in", paymentIds] },
            fields: ["name", "fecha_hora_pago", "monto", "modo_pago", "categoria_pago", "creation"],
            order_by: "creation desc"
        },
        callback: (r) => {
            const payments = r.message || [];

            // Calcular estadísticas por categoría
            renderCategoryStats(payments, montoCaja);

            payments.forEach(p => {
                const tr = document.createElement('tr');
                tr.className = 'cursor-pointer';
                tr.onclick = () => viewPaymentDetail(p.name);
                tr.innerHTML = `
                    <td class="ps-4 fw-medium text-secondary">${formatDateTime(p.creation)}</td>
                    <td><span class="badge border text-dark bg-light px-2 py-1">${p.modo_pago}</span></td>
                    <td class="text-end fw-bold">S/ ${formatCurrency(p.monto)}</td>
                    <td class="text-center">
                        <button class="btn btn-sm hover-bg-danger-light p-2 rounded-circle border-0" onclick="event.stopPropagation(); deleteHistoryPayment('${p.name}')" title="Eliminar Pago">
                            ❌
                        </button>
                    </td>
                `;
                list.appendChild(tr);
            });
        }
    });
}

window.closePaymentsHistory = (fromHistory = false) => {
    document.getElementById('paymentsHistoryModal').classList.remove('active');
    if (fromHistory) {
        isModalPushed = false;
    } else {
        clearModalState();
    }
    loadCajas();
};

// --- Single Payment Registration Modal ---
window.openPaymentModal = () => {
    const form = document.getElementById('paymentForm');
    if (form) form.reset();
    document.getElementById('pInputFecha').valueAsDate = new Date();
    document.getElementById('pInputNotas').value = '';
    const catSel = document.getElementById('pInputCategoria');
    if (catSel) catSel.value = '';

    currentPaymentAttachments = [];
    renderPaymentAttachmentsList();
    document.getElementById('paymentModal').classList.add('active');
};

window.closePaymentModal = (fromHistory = false) => {
    document.getElementById('paymentModal').classList.remove('active');
};

window.closePaymentDetailModal = (fromHistory = false) => {
    document.getElementById('paymentDetailModal').classList.remove('active');
};

window.viewPaymentDetail = (paymentName) => {
    frappe.call({
        method: "frappe.client.get",
        args: {
            doctype: "Pago Finanzas P",
            name: paymentName
        },
        callback: (r) => {
            if (r.message) {
                const p = r.message;
                document.getElementById('pdMonto').textContent = `S/ ${formatCurrency(p.monto)}`;
                document.getElementById('pdModo').textContent = p.modo_pago;
                document.getElementById('pdFecha').textContent = formatDate(p.fecha_hora_pago);
                document.getElementById('pdCategoria').textContent = p.categoria_pago || 'Sin categoría';

                const notesElem = document.getElementById('pdNotas');
                if (p.notas) {
                    notesElem.textContent = p.notas;
                    document.getElementById('pdNotasContainer').classList.remove('d-none');
                } else {
                    document.getElementById('pdNotasContainer').classList.add('d-none');
                }

                // Render Attachments
                const attList = document.getElementById('pdAttachments');
                attList.innerHTML = '';
                if (p.adjuntos_pagos && p.adjuntos_pagos.length > 0) {
                    p.adjuntos_pagos.forEach(a => {
                        const div = document.createElement('div');
                        div.className = 'file-preview-item';
                        div.innerHTML = `<img src="${a.adjunto}"><div class="file-label">${a.categoria_pago || ''}</div>`;
                        div.querySelector('img').onclick = (e) => { e.stopPropagation(); openLightbox(a.adjunto); };
                        attList.appendChild(div);
                    });
                } else {
                    attList.innerHTML = '<div class="text-muted small">Sin adjuntos</div>';
                }

                document.getElementById('paymentDetailModal').classList.add('active');
            }
        }
    });
};

async function handlePaymentSubmit(e) {
    e.preventDefault();
    if (!currentCajaForPayments) return;

    const btn = document.getElementById('btnSavePayment');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    frappe.call({
        method: "finhub.www.caja_chica.index.create_payment",
        args: {
            caja_name: currentCajaForPayments,
            monto: data.monto,
            fecha: data.fecha,
            modo_pago: data.modo_pago,
            categoria_pago: data.categoria_pago,
            notas: data.notas,
            adjuntos: JSON.stringify(currentPaymentAttachments.map(a => ({ categoria: a.category, archivo: a.file_url })))
        },
        callback: (r) => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            if (r.message && r.message.status === 'success') {
                frappe.show_alert({ message: 'Pago registrado correctamente', indicator: 'green' });
                closePaymentModal();
                openPaymentsHistory(currentCajaForPayments); // Refresh history
            } else {
                frappe.msgprint({ title: 'Error', indicator: 'red', message: r.message ? r.message.message : 'Error al registrar el pago' });
            }
        }
    });
}

// --- Quick Create Feature (Modern Modal) ---
let quickCreateTarget = { doctype: '', selectId: '', fieldName: 'name' };

window.openQuickCreateModal = (doctype, selectId, fieldName = 'name') => {
    quickCreateTarget = { doctype, selectId, fieldName };
    const title = document.getElementById('quickCreateTitle');
    const input = document.getElementById('quickCreateInput');

    if (title) title.textContent = `Nuevo ${doctype}`;
    if (input) {
        input.value = '';
        input.placeholder = `Ingresa ${doctype.toLowerCase()}...`;
    }

    const modal = document.getElementById('quickCreateModal');
    if (modal) {
        modal.classList.add('active');
    }

    renderQuickCreateList();
    setTimeout(() => { if (input) input.focus(); }, 200);
};

async function renderQuickCreateList() {
    const listContainer = document.getElementById('quickCreateList');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="p-3 text-center small text-muted"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: quickCreateTarget.doctype,
            fields: [quickCreateTarget.fieldName],
            order_by: `${quickCreateTarget.fieldName} asc`
        },
        callback: (r) => {
            const items = r.message || [];
            listContainer.innerHTML = '';

            if (items.length === 0) {
                listContainer.innerHTML = '<div class="p-3 text-center small text-muted">No hay elementos</div>';
                return;
            }

            items.forEach(item => {
                const name = item[quickCreateTarget.fieldName];
                const div = document.createElement('div');
                div.className = 'quick-list-item';
                div.innerHTML = `
                    <span class="fw-medium">${name}</span>
                    <button class="btn-delete-quick" onclick="deleteQuickCreateItem('${name}')" title="Eliminar">
                        ❌
                    </button>
                `;
                listContainer.appendChild(div);
            });
        }
    });
}

window.deleteQuickCreateItem = (name) => {
    if (!confirm(`¿Estás seguro de eliminar "${name}"? Esta acción podría fallar si está en uso.`)) return;

    frappe.call({
        method: "frappe.client.delete",
        args: {
            doctype: quickCreateTarget.doctype,
            name: name
        },
        callback: (r) => {
            if (!r.exc) {
                frappe.show_alert({ message: 'Eliminado correctamente', indicator: 'orange' });
                renderQuickCreateList();

                // Refresh all internal data
                frappe.call({
                    method: "finhub.www.caja_chica.index.get_initial_data",
                    callback: (refreshRes) => {
                        if (refreshRes.message) {
                            paymentMethods = refreshRes.message.payment_methods || [];
                            usersList = refreshRes.message.users || [];
                            attachmentCategories = refreshRes.message.attachment_categories || [];
                            paymentCategories = refreshRes.message.payment_categories || [];
                            loadInitialData();
                        }
                    }
                });
            } else {
                frappe.msgprint({
                    title: 'No se puede eliminar',
                    message: `Es posible que "${name}" ya esté asociado a registros de pagos existentes y no pueda ser borrado por integridad de datos.`,
                    indicator: 'red'
                });
            }
        }
    });
};

window.closeQuickCreateModal = (fromHistory = false) => {
    const modal = document.getElementById('quickCreateModal');
    if (modal) modal.classList.remove('active');
};

const btnConfirmQC = document.getElementById('btnConfirmQuickCreate');
if (btnConfirmQC) btnConfirmQC.onclick = () => handleQuickCreateConfirm();

const inputQC = document.getElementById('quickCreateInput');
if (inputQC) {
    inputQC.onkeydown = (e) => {
        if (e.key === 'Enter') handleQuickCreateConfirm();
    };
}

async function handleQuickCreateConfirm() {
    const input = document.getElementById('quickCreateInput');
    const name = input ? input.value.trim() : '';
    if (!name) return;

    const btn = document.getElementById('btnConfirmQuickCreate');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    const doc = { doctype: quickCreateTarget.doctype };
    doc[quickCreateTarget.fieldName] = name;

    frappe.call({
        method: "frappe.client.insert",
        args: { doc: doc },
        callback: (r) => {
            btn.disabled = false;
            btn.innerHTML = originalContent;

            if (!r.exc) {
                frappe.show_alert({ message: 'Creado correctamente', indicator: 'green' });
                renderQuickCreateList();

                // Refresh data
                frappe.call({
                    method: "finhub.www.caja_chica.index.get_initial_data",
                    callback: (refreshRes) => {
                        if (refreshRes.message) {
                            // Refresh all internal lists
                            paymentMethods = refreshRes.message.payment_methods || [];
                            usersList = refreshRes.message.users || [];
                            attachmentCategories = refreshRes.message.attachment_categories || [];
                            paymentCategories = refreshRes.message.payment_categories || [];

                            // Update DOM for the specific select
                            const sel = document.getElementById(quickCreateTarget.selectId);
                            if (sel) {
                                if (quickCreateTarget.selectId === 'attachmentCategorySelect') {
                                    // Re-populate attachment categories select
                                    const list = (attachmentTarget === 'payment') ? paymentCategories : attachmentCategories;
                                    sel.innerHTML = `<option value="">${attachmentTarget === 'payment' ? 'Categoría de Pago...' : 'Categoría de Adjunto...'}</option>`;
                                    list.forEach(c => {
                                        const opt = document.createElement('option');
                                        opt.value = c;
                                        opt.textContent = c;
                                        sel.appendChild(opt);
                                    });
                                } else {
                                    // For other selects like pInputModo, loadInitialData handles the population
                                    loadInitialData();
                                }

                                // Set the value after a small delay to ensure DOM is ready
                                setTimeout(() => {
                                    sel.value = name;
                                }, 100);
                            }
                        }
                    }
                });
            } else {
                frappe.msgprint({ title: 'Error', message: 'No se pudo crear. Es posible que ya exista o no tengas permisos.', indicator: 'red' });
            }
        }
    });
}

// ... Attachment Handling ...
// Basic clipboard paste handled by event listener below

document.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.items) {
        // Automatically determine target based on active modal
        const isPaymentModalOpen = document.getElementById('paymentModal').classList.contains('active');
        attachmentTarget = isPaymentModalOpen ? 'payment' : 'caja';

        for (const item of e.clipboardData.items) {
            if (item.type.indexOf("image") !== -1) {
                prepareAttachmentUpload(item.getAsFile());
                break;
            }
        }
    }
});


async function processAttachmentUpload(file, category) {
    frappe.show_alert({ message: 'Subiendo archivo...', indicator: 'blue' });
    const formData = new FormData();

    // Determine filename
    let fileName = file.name;
    if (!fileName) {
        const ext = file.type === 'application/pdf' ? 'pdf' : 'png';
        fileName = `att-${Date.now()}.${ext}`;
    }

    formData.append('file', file, fileName);
    formData.append('is_private', 0);

    try {
        const res = await fetch('/api/method/upload_file', {
            method: 'POST',
            headers: { 'X-Frappe-CSRF-Token': frappe.csrf_token },
            body: formData
        });
        const result = await res.json();

        if (result.message && result.message.file_url) {
            if (attachmentTarget === 'caja') {
                currentAttachments.push({ file_url: result.message.file_url, category: category });
                renderAttachmentsList();
            } else {
                currentPaymentAttachments.push({ file_url: result.message.file_url, category: category });
                renderPaymentAttachmentsList();
            }
            frappe.show_alert({ message: 'Adjunto subido correctamente', indicator: 'green' });
            return true;
        }
    } catch (err) {
        frappe.show_alert('Error al subir el archivo', 'red');
        console.error(err);
    }
    return false;
}

function prepareAttachmentUpload(file) {
    // Automatic upload for payments
    if (attachmentTarget === 'payment') {
        processAttachmentUpload(file, "Pago Estandar");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('attachmentPreviewImg').src = e.target.result;

        // Contextual Title and Categories
        const titleElem = document.querySelector('#attachmentCategoryModal .modal-header-modern h6');
        const catSel = document.getElementById('attachmentCategorySelect');
        const quickAddBtn = document.querySelector('#attachmentCategoryModal .btn-quick-add');

        if (attachmentTarget === 'payment') {
            if (titleElem) titleElem.textContent = 'Clasificar Pago';
            // Populate with Payment Categories
            if (catSel) {
                catSel.innerHTML = '<option value="">Categoría de Pago...</option>';
                paymentCategories.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = c;
                    catSel.appendChild(opt);
                });
            }
            // Update quick create button to target 'Categoria Pago'
            if (quickAddBtn) {
                quickAddBtn.onclick = () => openQuickCreateModal('Categoria Pago', 'attachmentCategorySelect', 'nombre');
            }
        } else {
            if (titleElem) titleElem.textContent = 'Clasificar para Caja';
            // Populate with Caja Attachment Categories
            if (catSel) {
                catSel.innerHTML = '<option value="">Categoría de Adjunto...</option>';
                attachmentCategories.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = c;
                    catSel.appendChild(opt);
                });
            }
            // Update quick create button to target 'Categoria Adjuntos Finanzas'
            if (quickAddBtn) {
                quickAddBtn.onclick = () => openQuickCreateModal('Categoria Adjuntos Finanzas', 'attachmentCategorySelect', 'categoria_adjuntos');
            }
        }

        document.getElementById('attachmentCategoryModal').classList.add('active');
        window.tempBlob = file;
    };
    reader.readAsDataURL(file);
}

window.confirmCloseCaja = (name) => {
    frappe.confirm(`¿Estás seguro de que deseas cerrar la <b>Caja Chica ${name}</b>? Esta acción desactivará el registro de nuevos pagos.`, () => {
        frappe.call({
            method: "finhub.www.caja_chica.index.close_caja_manual",
            args: { name: name },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: 'Caja Chica cerrada correctamente', indicator: 'green' });
                    loadCajas();
                } else {
                    frappe.msgprint({ title: 'Error', indicator: 'red', message: r.message ? r.message.message : 'Error al cerrar la caja' });
                }
            }
        });
    });
};

window.closeAttachmentModal = (fromHistory = false) => {
    document.getElementById('attachmentCategoryModal').classList.remove('active');
};

window.confirmAttachment = async () => {
    const cat = document.getElementById('attachmentCategorySelect').value || 'Otros';
    const file = window.tempBlob;

    const success = await processAttachmentUpload(file, cat);
    if (success) {
        closeAttachmentModal();
    }
};

window.handlePaymentPaste = () => {
    attachmentTarget = 'payment';
    window.handlePasteButton_Original();
};

window.triggerPaymentManualUpload = () => {
    attachmentTarget = 'payment';
    window.triggerManualUpload_Original();
};

window.handlePasteButton = () => {
    attachmentTarget = 'caja';
    window.handlePasteButton_Original();
};

window.triggerManualUpload = () => {
    attachmentTarget = 'caja';
    window.triggerManualUpload_Original();
};

window.handlePasteButton_Original = async () => {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const type = item.types.find(t => t.startsWith('image/'));
            if (type) {
                const blob = await item.getType(type);
                prepareAttachmentUpload(blob);
                return;
            }
        }
        frappe.show_alert('No hay imagen en el portapapeles. Usa CTRL+V.', 'orange');
    } catch { frappe.show_alert('Acceso al portapapeles denegado.', 'red'); }
};

window.triggerManualUpload_Original = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = (e) => {
        if (e.target.files && e.target.files[0]) prepareAttachmentUpload(e.target.files[0]);
    };
    input.click();
};

function renderPaymentAttachmentsList() {
    const container = document.getElementById('paymentAttachmentsList');
    if (!container) return;
    container.innerHTML = currentPaymentAttachments.length === 0 ? '<div class="text-muted small py-2 px-3 border border-dashed rounded w-100 text-center">Sin comprobantes</div>' : '';
    currentPaymentAttachments.forEach((a, i) => {
        const div = document.createElement('div');
        div.className = 'file-preview-item small';
        div.innerHTML = `<img src="${a.file_url}"><div class="file-label">${a.category || ''}</div><button class="btn-remove-att" onclick="removePaymentAttachment(${i})">❌</button>`;
        div.querySelector('img').onclick = (e) => { e.stopPropagation(); openLightbox(a.file_url); };
        container.appendChild(div);
    });
}

window.removePaymentAttachment = (i) => {
    currentPaymentAttachments.splice(i, 1);
    renderPaymentAttachmentsList();
};

function renderAttachmentsList() {
    const container = document.getElementById('attachmentsList');
    container.innerHTML = currentAttachments.length === 0 ? '<div class="text-muted small py-3 px-2 border border-dashed rounded w-100 text-center">Sin adjuntos</div>' : '';
    currentAttachments.forEach((a, i) => {
        const div = document.createElement('div');
        div.className = 'file-preview-item';
        div.innerHTML = `<img src="${a.file_url}"><div class="file-label">${a.category || ''}</div><button class="btn-remove-att" onclick="removeAttachment(${i})">❌</button>`;
        div.querySelector('img').onclick = (e) => { e.stopPropagation(); openLightbox(a.file_url); };
        container.appendChild(div);
    });
}
window.removeAttachment = (i) => { currentAttachments.splice(i, 1); renderAttachmentsList(); };

// Handled by Original version

function formatCurrency(v) { return parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatDate(s) {
    if (!s) return '-';
    // If it's a date string like "YYYY-MM-DD", parse as local time
    if (typeof s === 'string' && s.includes('-') && !s.includes(' ') && !s.includes('T')) {
        const parts = s.split('-');
        if (parts.length === 3) {
            const d = new Date(parts[0], parts[1] - 1, parts[2]);
            return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        }
    }
    const d = new Date(s);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    let d;
    // Handle "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD"
    if (typeof dateStr === 'string' && dateStr.includes('-')) {
        const parts = dateStr.replace('T', ' ').split(' ');
        const dateParts = parts[0].split('-');
        const timeParts = parts[1] ? parts[1].split(':') : [0, 0, 0];
        d = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0] || 0, timeParts[1] || 0, timeParts[2] || 0);
    } else {
        d = new Date(dateStr);
    }
    const dayMonth = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${dayMonth} - ${time}`;
}

window.deleteCurrentBox = () => {
    const name = document.getElementById('cajaId').value;
    if (confirm(`¿Estás seguro de eliminar la caja ${name}? Esta acción no se puede deshacer.`)) {
        frappe.call({
            method: "finhub.www.caja_chica.index.delete_caja",
            args: { name },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert('Caja eliminada correctamente', 'green');
                    closeDetailPane();
                    loadCajas();
                }
            }
        });
    }
};

function renderCategoryStats(payments, montoCaja) {
    const container = document.getElementById('categoryStatsContainer');
    if (!container) return;

    // Agrupar por categoría
    const categoryMap = {};
    let totalGastado = 0;
    payments.forEach(p => {
        const cat = p.categoria_pago || 'Sin categoría';
        const monto = parseFloat(p.monto || 0);
        if (!categoryMap[cat]) categoryMap[cat] = 0;
        categoryMap[cat] += monto;
        totalGastado += monto;
    });

    if (Object.keys(categoryMap).length === 0) {
        container.innerHTML = '';
        return;
    }

    // Ordenar por monto desc
    const sorted = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);

    // Colores para las barras
    const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

    let html = `<div class="category-stats-section">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="fw-bold mb-0">Gasto por Categoría</h6>
            <span class="text-muted small">${sorted.length} categoría${sorted.length > 1 ? 's' : ''}</span>
        </div>
        <div class="category-stats-list">`;

    sorted.forEach(([cat, monto], i) => {
        const percent = totalGastado > 0 ? (monto / totalGastado * 100) : 0;
        const color = colors[i % colors.length];
        html += `
            <div class="category-stat-item">
                <div class="category-stat-header">
                    <div class="d-flex align-items-center gap-2">
                        <span class="category-color-dot" style="background: ${color}"></span>
                        <span class="category-stat-name">${cat}</span>
                    </div>
                    <div class="category-stat-values">
                        <span class="category-stat-amount">S/ ${formatCurrency(monto)}</span>
                        <span class="category-stat-percent">${Math.round(percent)}%</span>
                    </div>
                </div>
                <div class="category-stat-bar">
                    <div class="category-stat-bar-fill" style="width: ${percent}%; background: ${color}"></div>
                </div>
            </div>`;
    });

    html += `</div></div>`;
    container.innerHTML = html;
}

window.deleteHistoryPayment = (paymentName) => {
    if (confirm('¿Eliminar este registro de pago permanentemente?')) {
        frappe.call({
            method: "finhub.www.caja_chica.index.delete_payment",
            args: { name: paymentName, caja_name: currentCajaForPayments },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert('Pago eliminado', 'orange');
                    if (currentCajaForPayments) openPaymentsHistory(currentCajaForPayments);
                }
            }
        });
    }
};

// ========= Tabs + Gastos Distribucion integrados =========

window._cchCurrentCaja = null;
let cchGDCatalogs = null;
let cchGDPedidoTipoActivo = "Sales Invoice";
let cchGDPedidoTimer = null;
let cchGDPedidos = [];

window.cchSwitchTab = function (tab) {
    document.querySelectorAll('.cch-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    const caja = document.getElementById('cchTabCaja');
    const gd = document.getElementById('cchTabGD');
    const footer = document.querySelector('.detail-footer');
    if (tab === 'caja') {
        caja.style.display = '';
        caja.classList.add('active');
        gd.style.display = 'none';
        gd.classList.remove('active');
        if (footer) footer.style.display = '';
    } else {
        caja.style.display = 'none';
        caja.classList.remove('active');
        gd.style.display = '';
        gd.classList.add('active');
        if (footer) footer.style.display = 'none';
    }
};

function cchGDOnCajaOpen() {
    const empty = document.getElementById('cchGDEmpty');
    const content = document.getElementById('cchGDContent');
    const list = document.getElementById('cchGDList');
    const info = document.getElementById('cchGDSaldoInfo');
    const btnNuevo = document.getElementById('cchGDBtnNuevo');
    const caja = window._cchCurrentCaja;

    if (!caja || !caja.name) {
        if (empty) empty.style.display = '';
        if (content) content.style.display = 'none';
        return;
    }

    if (empty) empty.style.display = 'none';
    if (content) content.style.display = '';
    if (info) info.textContent = `Caja ${caja.name} · ${caja.estado} · Saldo: S/ ${parseFloat(caja.saldo_restante || 0).toFixed(2)}`;
    if (btnNuevo) btnNuevo.style.display = caja.estado === 'Abierta' ? '' : 'none';
    if (list) list.innerHTML = '<div class="text-muted small">Cargando...</div>';

    frappe.call({
        method: 'finhub.www.caja_chica.index.get_gastos_distribucion_by_caja',
        args: { caja_name: caja.name },
        callback: (r) => {
            if (r.message && r.message.status === 'success') {
                cchGDRenderList(r.message.rows || []);
            } else {
                if (list) list.innerHTML = '<div class="text-danger small">' + escapeHtmlSafe(r.message && r.message.message || 'Error') + '</div>';
            }
        }
    });
}

function cchGDRenderList(rows) {
    const list = document.getElementById('cchGDList');
    if (!list) return;
    if (!rows.length) {
        list.innerHTML = '<div class="text-muted text-center py-4"><i class="fas fa-inbox me-1"></i> Sin gastos de distribución</div>';
        return;
    }
    list.innerHTML = rows.map(function (r) {
        const peds = Array.isArray(r.pedidos) ? r.pedidos : [];
        let pedido = '';
        if (peds.length) {
            const first = peds[0];
            const extra = peds.length > 1 ? ' +' + (peds.length - 1) : '';
            pedido = '<span class="badge bg-info-subtle text-info"><i class="fas fa-link me-1"></i>' + escapeHtmlSafe(first.pedido) + (first.cliente ? ' · ' + escapeHtmlSafe(first.cliente) : '') + extra + '</span>';
        }
        const desc = r.descripcion ? '<div class="small text-muted mt-1">' + escapeHtmlSafe(r.descripcion) + '</div>' : '';
        return '<div class="cch-gd-card" data-name="' + escapeHtmlSafe(r.name) + '">' +
            '<div class="cch-gd-card-top">' +
                '<div class="cch-gd-card-info">' +
                    '<div class="cch-gd-card-title"><b>' + escapeHtmlSafe(r.name) + '</b> <span class="text-muted">· ' + escapeHtmlSafe(r.categoria || '-') + '</span></div>' +
                    '<div class="cch-gd-card-meta small text-muted">' + escapeHtmlSafe(r.fecha || '') + ' · ' + escapeHtmlSafe(r.metodo_pago || '') + ' · ' + escapeHtmlSafe(r.estado || '') + '</div>' +
                    pedido +
                    desc +
                '</div>' +
                '<div class="cch-gd-card-amount">S/ ' + parseFloat(r.monto || 0).toFixed(2) + '</div>' +
            '</div>' +
            '<div class="cch-gd-card-actions">' +
                '<button class="btn btn-sm btn-light border" onclick="cchGDEdit(\'' + escapeHtmlSafe(r.name) + '\')"><i class="fas fa-edit"></i></button>' +
                '<button class="btn btn-sm btn-outline-danger border" onclick="cchGDDelete(\'' + escapeHtmlSafe(r.name) + '\')"><i class="fas fa-trash"></i></button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function escapeHtmlSafe(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function cchGDLoadCatalogs(cb, force) {
    if (cchGDCatalogs && !force) { cb(cchGDCatalogs); return; }
    frappe.call({
        method: 'finhub.www.caja_chica.index.get_gastos_distribucion_initial_data',
        callback: (r) => {
            if (r.message && r.message.status === 'success') {
                cchGDCatalogs = r.message;
                cb(cchGDCatalogs);
            } else {
                frappe.msgprint({ title: 'Error', indicator: 'red', message: (r.message && r.message.message) || 'No se pudo cargar catálogos' });
            }
        }
    });
}

let cchGDAttachments = [];
let cchGDPendingAttachment = null;
let cchGDWizardStep = 1;

function cchGDFillSelects(cat) {
    const selCat = document.getElementById('cchGDInputCategoria');
    const selMet = document.getElementById('cchGDInputMetodo');
    const selAtt = document.getElementById('cchGDAttachCategorySelect');
    const prevCat = selCat ? selCat.value : '';
    const prevMet = selMet ? selMet.value : '';
    if (selCat) selCat.innerHTML = '<option value="">Seleccione...</option>' + cat.categorias.map(c => '<option value="' + escapeHtmlSafe(c) + '">' + escapeHtmlSafe(c) + '</option>').join('');
    if (selMet) selMet.innerHTML = '<option value="">Seleccione...</option>' + cat.metodos_pago.map(m => '<option value="' + escapeHtmlSafe(m) + '">' + escapeHtmlSafe(m) + '</option>').join('');
    if (selAtt) selAtt.innerHTML = '<option value="">Seleccione...</option>' + (cat.categorias_adjuntos || []).map(c => '<option value="' + escapeHtmlSafe(c) + '">' + escapeHtmlSafe(c) + '</option>').join('');
    if (selCat && prevCat) selCat.value = prevCat;
    if (selMet && prevMet) selMet.value = prevMet;
}

window.cchGDOpenForm = function (gasto) {
    const caja = window._cchCurrentCaja;
    if (!caja || !caja.name) { frappe.msgprint('Seleccione una caja primero'); return; }
    if (caja.estado !== 'Abierta') { frappe.msgprint('La caja no está abierta'); return; }

    cchGDLoadCatalogs((cat) => {
        cchGDFillSelects(cat);
        const selCat = document.getElementById('cchGDInputCategoria');
        const selMet = document.getElementById('cchGDInputMetodo');

        document.getElementById('cchGDInputName').value = (gasto && gasto.name) || '';
        document.getElementById('cchGDInputFecha').value = (gasto && gasto.fecha) || new Date().toISOString().split('T')[0];
        document.getElementById('cchGDInputMonto').value = (gasto && gasto.monto) || '';
        selCat.value = (gasto && gasto.categoria) || '';
        selMet.value = (gasto && gasto.metodo_pago) || '';
        document.getElementById('cchGDInputDescripcion').value = (gasto && gasto.descripcion) || '';
        document.getElementById('cchGDModalTitle').textContent = (gasto && gasto.name) ? ('Editar ' + gasto.name) : 'Nuevo Gasto de Distribución';

        cchGDAttachments = (gasto && gasto.adjuntos) ? gasto.adjuntos.map(a => ({ archivo: a.archivo, categoria: a.categoria })) : [];
        cchGDRenderAttachments();

        cchGDSetPedidos((gasto && gasto.pedidos) || []);

        cchGDWizardGoTo(1, true);
        document.getElementById('cchGDModal').classList.add('active');
        pushModalState();
    });
};

window.cchGDCloseForm = function () {
    document.getElementById('cchGDModal').classList.remove('active');
    clearModalState();
};

window.cchGDEdit = function (gastoName) {
    frappe.call({
        method: 'finhub.www.caja_chica.index.get_gastos_distribucion_by_caja',
        args: { caja_name: window._cchCurrentCaja.name },
        callback: (r) => {
            if (r.message && r.message.status === 'success') {
                const g = (r.message.rows || []).find(x => x.name === gastoName);
                if (g) cchGDOpenForm(g);
            }
        }
    });
};

window.cchGDDelete = function (gastoName) {
    const caja = window._cchCurrentCaja;
    if (!caja) return;
    if (!confirm('¿Eliminar este gasto? El monto será devuelto al saldo de la caja.')) return;
    frappe.call({
        method: 'finhub.www.caja_chica.index.delete_gasto_distribucion_from_caja',
        args: { gasto_name: gastoName, caja_name: caja.name },
        callback: (r) => {
            if (r.message && r.message.status === 'success') {
                frappe.show_alert({ message: r.message.message || 'Gasto eliminado', indicator: 'orange' });
                if (r.message.saldo_restante != null) {
                    window._cchCurrentCaja.saldo_restante = r.message.saldo_restante;
                }
                cchGDOnCajaOpen();
                loadCajas();
            } else {
                frappe.msgprint({ title: 'Error', indicator: 'red', message: (r.message && r.message.message) || 'Error' });
            }
        }
    });
};

window.cchGDSave = function () {
    const caja = window._cchCurrentCaja;
    if (!caja || caja.estado !== 'Abierta') return;

    const payload = {
        name: document.getElementById('cchGDInputName').value || null,
        fecha: document.getElementById('cchGDInputFecha').value,
        monto: document.getElementById('cchGDInputMonto').value,
        categoria: document.getElementById('cchGDInputCategoria').value,
        metodo_pago: document.getElementById('cchGDInputMetodo').value,
        descripcion: document.getElementById('cchGDInputDescripcion').value,
        estado: 'Pagado',
        pedidos: cchGDPedidos.map(p => ({ pedido_tipo: p.tipo, pedido: p.name })),
        adjuntos: cchGDAttachments.slice()
    };

    if (!payload.fecha || !payload.monto || !payload.categoria || !payload.metodo_pago) {
        frappe.msgprint('Complete fecha, monto, categoría y método de pago');
        return;
    }

    const btn = document.getElementById('cchGDBtnSave');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

    frappe.call({
        method: 'finhub.www.caja_chica.index.create_gasto_distribucion_from_caja',
        args: { caja_name: caja.name, data: JSON.stringify(payload) },
        callback: (r) => {
            btn.disabled = false;
            btn.innerHTML = orig;
            if (r.message && r.message.status === 'success') {
                frappe.show_alert({ message: 'Gasto guardado', indicator: 'green' });
                if (r.message.saldo_restante != null) {
                    window._cchCurrentCaja.saldo_restante = r.message.saldo_restante;
                }
                cchGDCloseForm();
                cchGDOnCajaOpen();
                loadCajas();
            } else {
                frappe.msgprint({ title: 'Error', indicator: 'red', message: (r.message && r.message.message) || 'Error' });
            }
        }
    });
};

function cchGDRenderPedidoChips() {
    const cont = document.getElementById('cchGDPedidoChips');
    if (!cont) return;
    if (!cchGDPedidos.length) { cont.innerHTML = ''; return; }
    cont.innerHTML = cchGDPedidos.map((p, idx) => {
        const label = p.tipo === 'Sales Invoice' ? 'Factura' : 'Borrador';
        const cliente = p.cliente ? ' · ' + escapeHtmlSafe(p.cliente) : '';
        const monto = p.monto ? ' · S/ ' + Number(p.monto).toFixed(2) : '';
        return '<span class="cch-gd-pedido-chip">' +
            '<span class="cch-gd-pedido-chip-label">' + label + ': <b>' + escapeHtmlSafe(p.name) + '</b>' + cliente + monto + '</span>' +
            '<button type="button" class="cch-gd-pedido-chip-x" onclick="cchGDRemovePedido(' + idx + ')"><i class="fas fa-times"></i></button>' +
            '</span>';
    }).join('');
}

window.cchGDAddPedido = function (tipo, name, info) {
    if (!tipo || !name) return;
    if (cchGDPedidos.some(p => p.tipo === tipo && p.name === name)) return;
    cchGDPedidos.push({
        tipo,
        name,
        cliente: (info && info.customer_name) || '',
        monto: Number((info && info.grand_total) || 0)
    });
    cchGDRenderPedidoChips();
};

window.cchGDRemovePedido = function (idx) {
    if (idx < 0 || idx >= cchGDPedidos.length) return;
    cchGDPedidos.splice(idx, 1);
    cchGDRenderPedidoChips();
};

window.cchGDSetPedidos = function (list) {
    cchGDPedidos = (list || [])
        .filter(p => p && p.pedido_tipo && p.pedido)
        .map(p => ({
            tipo: p.pedido_tipo,
            name: p.pedido,
            cliente: p.cliente || '',
            monto: Number(p.monto || 0)
        }));
    cchGDPedidoTipoActivo = 'Sales Invoice';
    const search = document.getElementById('cchGDPedidoSearch');
    if (search) { search.value = ''; }
    const results = document.getElementById('cchGDPedidoResults');
    if (results) { results.style.display = 'none'; results.innerHTML = ''; }
    document.querySelectorAll('.cch-gd-pedido-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === 'Sales Invoice'));
    cchGDRenderPedidoChips();
};

function cchGDRenderPedidoResults(rows) {
    const results = document.getElementById('cchGDPedidoResults');
    if (!results) return;
    if (!rows.length) {
        results.innerHTML = '<div class="cch-gd-pedido-empty">Sin resultados</div>';
        results.style.display = '';
        return;
    }
    results.innerHTML = rows.map(function (r) {
        const cliente = escapeHtmlSafe(r.customer_name || '');
        const monto = r.grand_total ? 'S/ ' + Number(r.grand_total).toFixed(2) : '';
        const courier = r.custom_courier ? escapeHtmlSafe(r.custom_courier) : '';
        const tienda = r.custom_tienda ? escapeHtmlSafe(r.custom_tienda) : '';
        const tel = r.direccion_telefono ? escapeHtmlSafe(r.direccion_telefono) : '';
        const dirRaw = r.direccion_texto ? String(r.direccion_texto) : '';
        const dir = dirRaw.length > 45 ? escapeHtmlSafe(dirRaw.slice(0, 45) + '…') : escapeHtmlSafe(dirRaw);
        const meta3 = (courier || tienda)
            ? '<div class="cch-gd-pedido-meta"><i class="fas fa-truck"></i> ' + (courier || '—') + (tienda ? ' · <i class="fas fa-store"></i> ' + tienda : '') + '</div>'
            : '';
        const meta4 = (tel || dir)
            ? '<div class="cch-gd-pedido-meta">' + (tel ? '<i class="fas fa-phone"></i> ' + tel : '') + (tel && dir ? ' · ' : '') + (dir ? '<i class="fas fa-map-marker-alt"></i> ' + dir : '') + '</div>'
            : '';
        return '<div class="cch-gd-pedido-result" data-name="' + escapeHtmlSafe(r.name) + '" data-cliente="' + cliente + '" data-monto="' + (r.grand_total || 0) + '">' +
                    '<div class="cch-gd-pedido-line1"><b>' + escapeHtmlSafe(r.name) + '</b> <span>' + cliente + '</span></div>' +
                    '<div class="cch-gd-pedido-line2">' + escapeHtmlSafe(r.fecha || '') + ' · ' + monto + '</div>' +
                    meta3 +
                    meta4 +
                '</div>';
    }).join('');
    results.style.display = '';
    cchGDPositionDropdown();
    results.querySelectorAll('.cch-gd-pedido-result').forEach(el => {
        el.addEventListener('click', () => {
            cchGDAddPedido(cchGDPedidoTipoActivo, el.dataset.name, {
                customer_name: el.dataset.cliente,
                grand_total: Number(el.dataset.monto) || 0
            });
            const search = document.getElementById('cchGDPedidoSearch');
            if (search) { search.value = ''; search.focus(); }
            const r = document.getElementById('cchGDPedidoResults');
            if (r) { r.style.display = 'none'; r.innerHTML = ''; }
        });
    });
}

function cchGDPositionDropdown() {
    const results = document.getElementById('cchGDPedidoResults');
    const input = document.getElementById('cchGDPedidoSearch');
    if (!results || !input) return;
    const inputRect = input.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - inputRect.bottom - 12;
    const spaceAbove = inputRect.top - 12;
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
        results.style.top = 'calc(100% + 4px)';
        results.style.bottom = 'auto';
        results.style.maxHeight = Math.min(340, Math.max(160, spaceBelow)) + 'px';
    } else {
        results.style.top = 'auto';
        results.style.bottom = 'calc(100% + 4px)';
        results.style.maxHeight = Math.min(340, Math.max(160, spaceAbove)) + 'px';
    }
}

function cchGDDoPedidoSearch(q) {
    const query = (q || '').trim();
    const limit = query.length >= 2 ? 15 : 5;
    frappe.call({
        method: 'finhub.www.caja_chica.index.search_pedidos_for_gasto',
        args: { tipo: cchGDPedidoTipoActivo, q: query, limit },
        callback: (r) => {
            if (r.message && r.message.status === 'success') cchGDRenderPedidoResults(r.message.rows || []);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.cch-gd-pedido-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            cchGDPedidoTipoActivo = btn.dataset.tipo;
            document.querySelectorAll('.cch-gd-pedido-btn').forEach(b => b.classList.toggle('active', b === btn));
            const s = document.getElementById('cchGDPedidoSearch');
            cchGDDoPedidoSearch(s ? s.value.trim() : '');
        });
    });
    const s = document.getElementById('cchGDPedidoSearch');
    if (s) {
        s.addEventListener('input', (e) => {
            clearTimeout(cchGDPedidoTimer);
            const v = e.target.value.trim();
            cchGDPedidoTimer = setTimeout(() => cchGDDoPedidoSearch(v), 250);
        });
        s.addEventListener('focus', () => {
            // Mostrar 5 más recientes si vacío
            cchGDDoPedidoSearch(s.value.trim());
        });
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.cch-gd-pedido-wrap')) {
            const r = document.getElementById('cchGDPedidoResults');
            if (r) r.style.display = 'none';
        }
    });
});

// ========= Wizard nav =========

function cchGDValidateStep(step) {
    if (step === 1) {
        const fecha = document.getElementById('cchGDInputFecha').value;
        const monto = parseFloat(document.getElementById('cchGDInputMonto').value || 0);
        const cat = document.getElementById('cchGDInputCategoria').value;
        if (!fecha) { frappe.msgprint('Ingrese fecha'); return false; }
        if (!monto || monto <= 0) { frappe.msgprint('Ingrese monto válido'); return false; }
        if (!cat) { frappe.msgprint('Seleccione categoría'); return false; }
        const caja = window._cchCurrentCaja;
        if (caja && monto > parseFloat(caja.saldo_restante || 0)) {
            frappe.msgprint('Monto excede el saldo disponible (S/ ' + parseFloat(caja.saldo_restante).toFixed(2) + ')');
            return false;
        }
        return true;
    }
    if (step === 2) {
        const met = document.getElementById('cchGDInputMetodo').value;
        if (!met) { frappe.msgprint('Seleccione método de pago'); return false; }
        return true;
    }
    return true;
}

window.cchGDWizardGoTo = function (step, skipValidation) {
    if (!skipValidation && step > cchGDWizardStep) {
        for (let s = cchGDWizardStep; s < step; s++) {
            if (!cchGDValidateStep(s)) return;
        }
    }
    cchGDWizardStep = step;
    document.querySelectorAll('#cchGDModal .cch-gd-wizard-step').forEach(el => {
        const s = parseInt(el.dataset.step, 10);
        el.classList.toggle('active', s === step);
        el.classList.toggle('completed', s < step);
    });
    document.querySelectorAll('#cchGDModal .cch-gd-wizard-pane').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.step, 10) === step);
    });
    const back = document.getElementById('cchGDWizardBackBtn');
    const next = document.getElementById('cchGDWizardNextBtn');
    const save = document.getElementById('cchGDBtnSave');
    if (back) back.style.display = step > 1 ? '' : 'none';
    if (step === 3) {
        if (next) next.style.display = 'none';
        if (save) save.style.display = '';
    } else {
        if (next) next.style.display = '';
        if (save) save.style.display = 'none';
    }
};

window.cchGDWizardNext = function () {
    if (cchGDWizardStep >= 3) return;
    if (!cchGDValidateStep(cchGDWizardStep)) return;
    cchGDWizardGoTo(cchGDWizardStep + 1, true);
};

window.cchGDWizardPrev = function () {
    if (cchGDWizardStep <= 1) return;
    cchGDWizardGoTo(cchGDWizardStep - 1, true);
};

// ========= Adjuntos =========

function cchGDRenderAttachments() {
    const wrap = document.getElementById('cchGDAttachments');
    if (!wrap) return;
    if (!cchGDAttachments.length) {
        wrap.innerHTML = '<div class="cch-gd-attachments-empty"><i class="fas fa-paperclip me-1"></i> Sin comprobantes</div>';
        return;
    }
    wrap.innerHTML = cchGDAttachments.map((a, i) => {
        const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(a.archivo || '');
        const inner = isImg
            ? '<img src="' + escapeHtmlSafe(a.archivo) + '" alt="adj">'
            : '<div class="file-icon"><i class="fas fa-file-alt"></i></div>';
        return '<div class="cch-gd-attachment-item">' +
                inner +
                '<div class="cch-gd-attachment-cat">' + escapeHtmlSafe(a.categoria || 'Sin categoría') + '</div>' +
                '<button type="button" class="cch-gd-attachment-x" onclick="cchGDRemoveAttachment(' + i + ')" title="Quitar"><i class="fas fa-times"></i></button>' +
            '</div>';
    }).join('');
}

window.cchGDRemoveAttachment = function (idx) {
    cchGDAttachments.splice(idx, 1);
    cchGDRenderAttachments();
};

window.cchGDTriggerUpload = function () {
    const inp = document.getElementById('cchGDFileInput');
    if (!inp) return;
    inp.value = '';
    inp.onchange = (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) cchGDUploadFile(f);
    };
    inp.click();
};

window.cchGDPasteAttachment = async function () {
    try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
            for (const t of it.types) {
                if (t.startsWith('image/')) {
                    const blob = await it.getType(t);
                    const ext = t.split('/')[1] || 'png';
                    const file = new File([blob], 'paste-' + Date.now() + '.' + ext, { type: t });
                    return cchGDUploadFile(file);
                }
            }
        }
        frappe.show_alert({ message: 'Portapapeles sin imagen', indicator: 'orange' });
    } catch (e) {
        frappe.show_alert({ message: 'No se pudo leer el portapapeles', indicator: 'red' });
    }
};

function cchGDUploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('is_private', '0');
    fd.append('folder', 'Home/Attachments');
    fetch('/api/method/upload_file', {
        method: 'POST',
        headers: { 'X-Frappe-CSRF-Token': frappe.csrf_token },
        body: fd
    }).then(r => r.json()).then(j => {
        if (j.message && j.message.file_url) {
            cchGDPendingAttachment = { archivo: j.message.file_url };
            cchGDOpenAttachModal();
        } else {
            frappe.msgprint({ title: 'Error subiendo archivo', indicator: 'red', message: JSON.stringify(j).slice(0, 200) });
        }
    });
}

function cchGDOpenAttachModal() {
    const a = cchGDPendingAttachment;
    if (!a) return;
    const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(a.archivo);
    const img = document.getElementById('cchGDAttachPreview');
    if (img) img.src = isImg ? a.archivo : '';
    const sel = document.getElementById('cchGDAttachCategorySelect');
    if (sel && cchGDCatalogs && cchGDCatalogs.categorias_adjuntos) {
        sel.innerHTML = '<option value="">Seleccione...</option>' + cchGDCatalogs.categorias_adjuntos.map(c => '<option value="' + escapeHtmlSafe(c) + '">' + escapeHtmlSafe(c) + '</option>').join('');
    }
    document.getElementById('cchGDAttachCategoryModal').classList.add('active');
}

window.cchGDCloseAttachModal = function () {
    document.getElementById('cchGDAttachCategoryModal').classList.remove('active');
    cchGDPendingAttachment = null;
};

window.cchGDConfirmAttachment = function () {
    const sel = document.getElementById('cchGDAttachCategorySelect');
    const cat = sel ? sel.value : '';
    if (!cat) { frappe.msgprint('Seleccione una categoría'); return; }
    if (!cchGDPendingAttachment) return;
    cchGDAttachments.push({ archivo: cchGDPendingAttachment.archivo, categoria: cat });
    cchGDPendingAttachment = null;
    document.getElementById('cchGDAttachCategoryModal').classList.remove('active');
    cchGDRenderAttachments();
};

// ========= Catálogo CRUD =========

let cchGDCatalogState = { doctype: null, rows: [] };

const CCH_GD_CATALOG_LABELS = {
    'Categoria Gasto Distribucion': 'Categorías Gasto Distribución',
    'Metodo Pago': 'Métodos de Pago',
    'Categoria Adjuntos Finanzas': 'Categorías de Adjuntos'
};

window.cchGDOpenCatalogModal = function (doctype) {
    cchGDCatalogState = { doctype, rows: [] };
    document.getElementById('cchGDCatalogTitle').textContent = CCH_GD_CATALOG_LABELS[doctype] || doctype;
    document.getElementById('cchGDCatalogError').style.display = 'none';
    document.getElementById('cchGDCatalogList').innerHTML = '<div class="text-muted small">Cargando...</div>';
    document.getElementById('cchGDCatalogModal').classList.add('active');
    cchGDCatalogReload();
};

window.cchGDCloseCatalogModal = function () {
    document.getElementById('cchGDCatalogModal').classList.remove('active');
    // Refrescar selects del modal padre
    cchGDLoadCatalogs((cat) => cchGDFillSelects(cat), true);
};

function cchGDCatalogReload() {
    frappe.call({
        method: 'finhub.www.gastos_distribucion.index.list_catalog',
        args: { doctype: cchGDCatalogState.doctype },
        callback: (r) => {
            if (r.message && r.message.status === 'success') {
                cchGDCatalogState.rows = r.message.rows || [];
                cchGDRenderCatalogList();
            } else {
                cchGDCatalogShowError((r.message && r.message.message) || 'Error cargando');
            }
        }
    });
}

function cchGDRenderCatalogList() {
    const list = document.getElementById('cchGDCatalogList');
    if (!list) return;
    if (!cchGDCatalogState.rows.length) {
        list.innerHTML = '<div class="text-muted small text-center py-3">Sin registros. Pulse "Agregar" para crear uno.</div>';
        return;
    }
    list.innerHTML = cchGDCatalogState.rows.map((row, i) => {
        const name = escapeHtmlSafe(row.name);
        return '<div class="cch-gd-cat-row" data-idx="' + i + '">' +
            '<input type="text" value="' + name + '" data-original="' + name + '">' +
            '<div class="cch-gd-cat-actions">' +
                '<button type="button" onclick="cchGDCatalogSaveRow(' + i + ')" title="Guardar"><i class="fas fa-save"></i></button>' +
                '<button type="button" class="danger" onclick="cchGDCatalogDeleteRow(' + i + ')" title="Eliminar"><i class="fas fa-trash"></i></button>' +
            '</div>' +
        '</div>';
    }).join('');
}

window.cchGDCatalogAddNew = function () {
    cchGDCatalogState.rows.push({ name: '', _isNew: true });
    cchGDRenderCatalogList();
    const list = document.getElementById('cchGDCatalogList');
    const inputs = list.querySelectorAll('input');
    if (inputs.length) inputs[inputs.length - 1].focus();
};

window.cchGDCatalogSaveRow = function (idx) {
    const list = document.getElementById('cchGDCatalogList');
    const row = list.querySelector('.cch-gd-cat-row[data-idx="' + idx + '"]');
    const input = row.querySelector('input');
    const newName = input.value.trim();
    const original = input.dataset.original || '';
    if (!newName) { frappe.msgprint('Nombre vacío'); return; }
    const data = { nombre: newName };
    if (original) data.name = original;
    frappe.call({
        method: 'finhub.www.gastos_distribucion.index.save_catalog',
        args: { doctype: cchGDCatalogState.doctype, data: JSON.stringify(data) },
        callback: (r) => {
            if (r.message && r.message.status === 'success') {
                frappe.show_alert({ message: 'Guardado', indicator: 'green' });
                cchGDCatalogReload();
            } else {
                cchGDCatalogShowError((r.message && r.message.message) || 'Error');
            }
        }
    });
};

window.cchGDCatalogDeleteRow = function (idx) {
    const row = cchGDCatalogState.rows[idx];
    if (!row) return;
    if (row._isNew) {
        cchGDCatalogState.rows.splice(idx, 1);
        cchGDRenderCatalogList();
        return;
    }
    if (!confirm('¿Eliminar "' + row.name + '"?')) return;
    frappe.call({
        method: 'finhub.www.gastos_distribucion.index.delete_catalog',
        args: { doctype: cchGDCatalogState.doctype, name: row.name },
        callback: (r) => {
            if (r.message && r.message.status === 'success') {
                frappe.show_alert({ message: 'Eliminado', indicator: 'orange' });
                cchGDCatalogReload();
            } else {
                cchGDCatalogShowError((r.message && r.message.message) || 'Error');
            }
        }
    });
};

function cchGDCatalogShowError(msg) {
    const el = document.getElementById('cchGDCatalogError');
    if (el) {
        el.textContent = msg;
        el.style.display = '';
        setTimeout(() => { el.style.display = 'none'; }, 6000);
    }
}

// ===== Lightbox =====
window.openLightbox = (url) => {
    document.getElementById('lightboxImg').src = url;
    document.getElementById('lightboxOpenBtn').href = url;
    document.getElementById('imageLightbox').classList.add('active');
};
window.closeLightbox = () => {
    document.getElementById('imageLightbox').classList.remove('active');
    document.getElementById('lightboxImg').src = '';
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
