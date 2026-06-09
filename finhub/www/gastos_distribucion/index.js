(function () {
    const API = {
        init: "finhub.www.gastos_distribucion.index.get_initial_data",
        list: "finhub.www.gastos_distribucion.index.get_gastos_list",
        get: "finhub.www.gastos_distribucion.index.get_gasto",
        save: "finhub.www.gastos_distribucion.index.save_gasto",
        remove: "finhub.www.gastos_distribucion.index.delete_gasto",
        stats: "finhub.www.gastos_distribucion.index.get_summary_stats",
        catList: "finhub.www.gastos_distribucion.index.list_catalog",
        catSave: "finhub.www.gastos_distribucion.index.save_catalog",
        catDel: "finhub.www.gastos_distribucion.index.delete_catalog",
        searchPedidos: "finhub.www.gastos_distribucion.index.search_pedidos"
    };

    const CAN_EDIT = document.getElementById("gdSplit")?.dataset.canEdit === "1";

    const CATALOG_UI = {
        "Categoria Gasto Distribucion": {
            label: "Categorias Gasto Distribucion",
            fields: [
                { name: "nombre", label: "Nombre", type: "text", required: true },
                { name: "activo", label: "Activo", type: "check", default: 1 },
                { name: "descripcion", label: "Descripcion", type: "textarea" }
            ]
        },
        "Metodo Pago": {
            label: "Metodos de Pago",
            fields: [{ name: "nombre", label: "Nombre", type: "text", required: true }]
        },
        "Categoria Adjuntos Finanzas": {
            label: "Categorias de Adjuntos",
            fields: [{ name: "nombre", label: "Nombre", type: "text", required: true }]
        }
    };

    let categorias = [];
    let metodosPago = [];
    let categoriasAdjuntos = [];
    let cajasAbiertas = [];
    let currentGasto = null;
    let currentAttachments = [];
    let pendingAttachment = null;
    let searchTerm = "";
    let currentCatalogDoctype = null;
    let currentCatalogRows = [];

    const WIZARD = {
        rootSelector: '[data-wizard="gasto"]',
        totalSteps: 3,
        currentStep: 1,
        backBtnId: "gdWizardBackBtn",
        nextBtnId: "gdWizardNextBtn",
        saveBtnId: "gdWizardSaveBtn",
        validateStep(step) {
            if (step !== 1) return true;
            const fecha = document.getElementById("gdInputFecha").value;
            const monto = document.getElementById("gdInputMonto").value;
            const categoria = document.getElementById("gdInputCategoria").value;
            if (!fecha || !monto || !categoria) {
                frappe.msgprint("Completa fecha, monto y categoria antes de continuar");
                return false;
            }
            return true;
        }
    };

    document.addEventListener("DOMContentLoaded", () => {
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        document.getElementById("gdFilterStart").value = first.toISOString().split("T")[0];
        document.getElementById("gdFilterEnd").value = last.toISOString().split("T")[0];

        loadInitialData();
        loadList();

        let tid;
        document.getElementById("gdSearchInput").addEventListener("input", (e) => {
            clearTimeout(tid);
            searchTerm = (e.target.value || "").trim().toLowerCase();
            tid = setTimeout(renderFilteredList, 200);
        });

        document.getElementById("gdFilterStart").addEventListener("change", loadList);
        document.getElementById("gdFilterEnd").addEventListener("change", loadList);
        document.getElementById("gdFilterCategoria").addEventListener("change", loadList);
        document.getElementById("gdFilterEstado").addEventListener("change", loadList);

        if (CAN_EDIT) {
            document.getElementById("gdForm").addEventListener("submit", handleFormSubmit);
            document.getElementById("gdFilePicker").addEventListener("change", handleFileInput);
            const cajaSel = document.getElementById("gdInputCajaChica");
            if (cajaSel) cajaSel.addEventListener("change", updateCajaChicaInfo);
            const montoInput = document.getElementById("gdInputMonto");
            if (montoInput) montoInput.addEventListener("input", updateCajaChicaInfo);
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                gdCloseCatalogModal();
                gdCloseAttachCatModal();
                gdCloseDetail();
            }
        });
    });

    function loadInitialData() {
        frappe.call({
            method: API.init,
            callback: (r) => {
                const data = r.message || {};
                if (data.status === "error") return;

                categorias = (data.categorias || []).map((c) => c.name);
                metodosPago = data.metodos_pago || [];
                categoriasAdjuntos = data.categorias_adjuntos || [];
                cajasAbiertas = data.cajas_abiertas || [];

                fillSelect("gdInputCategoria", categorias, "Seleccione categoria...");
                fillSelect("gdFilterCategoria", categorias, "Todas las categorias", true);
                fillSelect("gdInputMetodo", metodosPago, "Seleccione metodo...");
                fillSelect("gdAttachCatSelect", categoriasAdjuntos, "Seleccione...");
                fillCajaChicaSelect();

                renderStats(data.stats || {});
            }
        });
    }

    function fillCajaChicaSelect() {
        const sel = document.getElementById("gdInputCajaChica");
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '<option value="">Sin vincular a caja chica</option>';
        (cajasAbiertas || []).forEach((c) => {
            const opt = document.createElement("option");
            opt.value = c.name;
            opt.dataset.saldo = c.saldo_restante;
            opt.dataset.responsable = c.responsable || "";
            const saldo = (c.saldo_restante || 0).toFixed(2);
            opt.textContent = `${c.name} · ${c.responsable || "Sin responsable"} · S/ ${saldo}`;
            sel.appendChild(opt);
        });
        if (prev) sel.value = prev;
        updateCajaChicaInfo();
    }

    function applyCajaChicaForGasto(gasto) {
        const sel = document.getElementById("gdInputCajaChica");
        const info = document.getElementById("gdCajaChicaInfo");
        if (!sel || !info) return;

        if (gasto && gasto.caja_chica) {
            // Edicion de gasto YA vinculado: caja read-only, no editable
            // (la cascada no se puede cambiar desde aqui).
            const caja = cajasAbiertas.find((c) => c.name === gasto.caja_chica);
            if (caja) {
                setSelectValue("gdInputCajaChica", gasto.caja_chica);
            } else {
                // La caja vinculada puede estar Cerrada -> no esta en cajasAbiertas.
                // Crear opcion temporal para mostrarla seleccionada.
                let opt = sel.querySelector(`option[value="${CSS.escape(gasto.caja_chica)}"]`);
                if (!opt) {
                    opt = document.createElement("option");
                    opt.value = gasto.caja_chica;
                    opt.textContent = `${gasto.caja_chica} (Cerrada)`;
                    sel.appendChild(opt);
                }
                sel.value = gasto.caja_chica;
            }
            sel.disabled = true;
            info.classList.remove("warn", "ok");
            info.textContent = `Vinculado a ${gasto.caja_chica}. Para desvincular o cambiar de caja, elimine el gasto y cree uno nuevo.`;
            return;
        }

        // Creacion o edicion de gasto SIN caja: si el gasto existe, no permitir vincular
        // (porque la cascada de Pago Finanzas P requiere crear desde cero).
        if (gasto && !gasto.caja_chica && gasto.name) {
            sel.value = "";
            sel.disabled = true;
            info.classList.remove("warn", "ok");
            info.textContent = "No se puede vincular caja a un gasto existente. Cree uno nuevo desde la caja.";
            return;
        }

        // Creacion limpia: dropdown habilitado
        sel.disabled = false;
        sel.value = "";
        updateCajaChicaInfo();
    }

    function updateCajaChicaInfo() {
        const sel = document.getElementById("gdInputCajaChica");
        const info = document.getElementById("gdCajaChicaInfo");
        if (!sel || !info) return;
        const cajaName = sel.value;
        info.classList.remove("warn", "ok");
        if (!cajaName) {
            info.textContent = "El gasto no se descontara de ninguna caja chica.";
            return;
        }
        const caja = cajasAbiertas.find((c) => c.name === cajaName);
        if (!caja) {
            info.textContent = "";
            return;
        }
        const monto = parseFloat(document.getElementById("gdInputMonto").value || 0) || 0;
        const saldo = caja.saldo_restante || 0;
        if (monto > saldo) {
            info.classList.add("warn");
            info.textContent = `Saldo disponible: S/ ${saldo.toFixed(2)}. El monto S/ ${monto.toFixed(2)} excede el saldo.`;
        } else {
            info.classList.add("ok");
            info.textContent = `Saldo disponible: S/ ${saldo.toFixed(2)}. Quedaria S/ ${(saldo - monto).toFixed(2)} tras este gasto.`;
        }
    }

    function loadList() {
        const filters = {
            start_date: document.getElementById("gdFilterStart").value,
            end_date: document.getElementById("gdFilterEnd").value,
            categoria: document.getElementById("gdFilterCategoria").value,
            estado: document.getElementById("gdFilterEstado").value
        };
        frappe.call({
            method: API.list,
            args: { filters: JSON.stringify(filters) },
            callback: (r) => {
                window._gdAll = r.message || [];
                renderFilteredList();
                loadStats();
            }
        });
    }

    function loadStats() {
        const filters = {
            start_date: document.getElementById("gdFilterStart").value,
            end_date: document.getElementById("gdFilterEnd").value
        };
        frappe.call({
            method: API.stats,
            args: { filters: JSON.stringify(filters) },
            callback: (r) => renderStats(r.message || {})
        });
    }

    function renderStats(stats) {
        document.getElementById("gdStatToday").textContent = fmt(stats.total_hoy || 0);
        document.getElementById("gdStatPeriodo").textContent = fmt(stats.total_periodo || 0);
    }

    function renderFilteredList() {
        const all = window._gdAll || [];
        const filtered = searchTerm
            ? all.filter((g) => (
                (g.name || "").toLowerCase().includes(searchTerm) ||
                (g.descripcion || "").toLowerCase().includes(searchTerm) ||
                (g.categoria || "").toLowerCase().includes(searchTerm)
            ))
            : all;

        document.getElementById("gdStatCount").textContent = filtered.length;

        const list = document.getElementById("gdList");
        list.innerHTML = "";

        if (!filtered.length) {
            list.innerHTML = '<div class="gd-empty"><i class="fas fa-folder-open fa-2x"></i><p>No hay registros</p></div>';
            return;
        }

        filtered.forEach((gasto) => {
            const card = document.createElement("div");
            card.className = "gd-card" + (currentGasto && currentGasto.name === gasto.name ? " selected" : "");
            card.onclick = () => openDetail(gasto);
            const estadoClass = "gd-status gd-status-" + (gasto.estado || "pendiente").toLowerCase();
            card.innerHTML = `
                <div class="gd-card-row">
                    <div>
                        <div class="gd-card-name">${escapeHtml(gasto.name)}</div>
                        <div class="gd-card-date">${formatDate(gasto.fecha)}</div>
                    </div>
                    <div class="gd-card-amount">${fmt(gasto.monto)}</div>
                </div>
                <div class="gd-card-row">
                    <span class="gd-card-cat">${escapeHtml(gasto.categoria || "Sin categoria")}</span>
                    <span class="${estadoClass}">${escapeHtml(gasto.estado || "Pendiente")}</span>
                </div>
                ${gasto.descripcion ? `<div class="gd-card-desc">${escapeHtml(gasto.descripcion)}</div>` : ""}
            `;
            list.appendChild(card);
        });
    }

    function renderAttachments() {
        const container = document.getElementById("gdAttachments");
        container.innerHTML = "";

        currentAttachments.forEach((att, idx) => {
            const item = document.createElement("div");
            item.className = "gd-attachment";
            const isImg = (att.archivo || "").match(/\.(png|jpg|jpeg|gif|webp)$/i);
            item.innerHTML = `
                ${isImg
                    ? `<img src="${att.archivo}" alt="adj">`
                    : '<div class="gd-attach-icon"><i class="fas fa-file-alt"></i></div>'}
                <span class="gd-attach-cat" title="${escapeHtml(att.categoria || "")}">${escapeHtml(att.categoria || "Sin cat.")}</span>
                ${CAN_EDIT ? `<button type="button" class="gd-attach-del" onclick="gdRemoveAttachment(${idx})"><i class="fas fa-times"></i></button>` : ""}
            `;
            item.onclick = (e) => {
                if (e.target.closest(".gd-attach-del")) return;
                if (att.archivo) window.open(att.archivo, "_blank");
            };
            container.appendChild(item);
        });
    }

    function openDetail(gasto) {
        currentGasto = gasto;
        currentAttachments = (gasto.adjuntos || []).map((a) => ({ categoria: a.categoria, archivo: a.archivo }));

        document.getElementById("gdDetailEmpty").classList.add("d-none");
        document.getElementById("gdDetailContent").classList.remove("d-none");
        document.getElementById("gdSplit").classList.add("detail-open");

        document.getElementById("gdDetailTitle").textContent = gasto.name;
        document.getElementById("gdInputName").value = gasto.name || "";
        document.getElementById("gdInputFecha").value = gasto.fecha || "";
        document.getElementById("gdInputMonto").value = gasto.monto || "";
        setSelectValue("gdInputCategoria", gasto.categoria);
        setSelectValue("gdInputMetodo", gasto.metodo_pago);
        setSelectValue("gdInputEstado", gasto.estado || "Pendiente");
        document.getElementById("gdInputDescripcion").value = gasto.descripcion || "";
        applyCajaChicaForGasto(gasto);

        setPedidosFromList(gasto.pedidos || []);

        const btnDel = document.getElementById("gdBtnDelete");
        if (btnDel) btnDel.classList.remove("d-none");

        renderAttachments();
        renderFilteredList();
        wizardReset();
    }

    window.gdOpenNew = function () {
        if (!CAN_EDIT) return;
        currentGasto = null;
        currentAttachments = [];

        document.getElementById("gdDetailEmpty").classList.add("d-none");
        document.getElementById("gdDetailContent").classList.remove("d-none");
        document.getElementById("gdSplit").classList.add("detail-open");

        document.getElementById("gdDetailTitle").textContent = "Nuevo Gasto de Distribucion";
        document.getElementById("gdInputName").value = "";
        document.getElementById("gdInputFecha").value = new Date().toISOString().split("T")[0];
        document.getElementById("gdInputMonto").value = "";
        setSelectValue("gdInputCategoria", "");
        setSelectValue("gdInputMetodo", "");
        setSelectValue("gdInputEstado", "Pendiente");
        document.getElementById("gdInputDescripcion").value = "";
        applyCajaChicaForGasto(null);

        clearAllPedidos();

        const btnDel = document.getElementById("gdBtnDelete");
        if (btnDel) btnDel.classList.add("d-none");

        renderAttachments();
        wizardReset();
    };

    window.gdCloseDetail = function () {
        document.getElementById("gdDetailContent").classList.add("d-none");
        document.getElementById("gdDetailEmpty").classList.remove("d-none");
        document.getElementById("gdSplit").classList.remove("detail-open");
        currentGasto = null;
        renderFilteredList();
    };

    function handleFormSubmit(e) {
        e.preventDefault();
        if (WIZARD.currentStep < WIZARD.totalSteps) {
            gdWizardNext();
            return;
        }

        const cajaChicaSel = document.getElementById("gdInputCajaChica");
        const cajaChicaValue = cajaChicaSel && !cajaChicaSel.disabled ? (cajaChicaSel.value || null) : null;

        const payload = {
            name: document.getElementById("gdInputName").value || null,
            fecha: document.getElementById("gdInputFecha").value,
            monto: document.getElementById("gdInputMonto").value,
            categoria: document.getElementById("gdInputCategoria").value,
            metodo_pago: document.getElementById("gdInputMetodo").value,
            estado: document.getElementById("gdInputEstado").value,
            descripcion: document.getElementById("gdInputDescripcion").value,
            caja_chica: cajaChicaValue,
            pedidos: pedidosSeleccionados.map((p) => ({ pedido_tipo: p.tipo, pedido: p.name })),
            adjuntos: currentAttachments
        };

        if (!payload.categoria) {
            frappe.msgprint("Seleccione una categoria");
            return;
        }
        if (!payload.monto) {
            frappe.msgprint("Ingrese un monto");
            return;
        }

        // Si se vincula caja, metodo_pago es requerido (create_payment lo necesita)
        if (cajaChicaValue && !payload.metodo_pago) {
            frappe.msgprint("Si vincula a caja chica, el metodo de pago es obligatorio");
            return;
        }

        // Validar saldo antes de enviar
        if (cajaChicaValue) {
            const caja = cajasAbiertas.find((c) => c.name === cajaChicaValue);
            if (caja && parseFloat(payload.monto) > (caja.saldo_restante || 0)) {
                frappe.msgprint(`Saldo insuficiente en ${caja.name}. Disponible: S/ ${(caja.saldo_restante || 0).toFixed(2)}`);
                return;
            }
        }

        frappe.call({
            method: API.save,
            args: { data: JSON.stringify(payload) },
            callback: (r) => {
                if (r.message?.status === "success") {
                    frappe.show_alert({ message: "Gasto guardado", indicator: "green" });
                    loadList();
                    // Refresca el listado de cajas para reflejar nuevo saldo
                    if (cajaChicaValue) loadInitialData();
                    if (r.message.name) {
                        frappe.call({
                            method: API.get,
                            args: { name: r.message.name },
                            callback: (rr) => {
                                if (rr.message) openDetail(rr.message);
                            }
                        });
                    }
                } else {
                    frappe.msgprint("Error: " + (r.message?.message || "no se pudo guardar"));
                }
            }
        });
    }

    window.gdDeleteCurrent = function () {
        if (!currentGasto) return;
        frappe.confirm(`¿Eliminar el gasto ${currentGasto.name}?`, () => {
            frappe.call({
                method: API.remove,
                args: { name: currentGasto.name },
                callback: (r) => {
                    if (r.message?.status === "success") {
                        frappe.show_alert({ message: "Eliminado", indicator: "red" });
                        gdCloseDetail();
                        loadList();
                    } else {
                        frappe.msgprint("Error: " + (r.message?.message || ""));
                    }
                }
            });
        });
    };

    window.gdTriggerUpload = function () {
        if (!CAN_EDIT) return;
        document.getElementById("gdFilePicker").click();
    };

    window.gdPasteAttachment = async function () {
        if (!CAN_EDIT) return;
        try {
            const items = await navigator.clipboard.read();
            for (const it of items) {
                for (const t of it.types) {
                    if (t.startsWith("image/")) {
                        const blob = await it.getType(t);
                        const file = new File([blob], `pegado-${Date.now()}.png`, { type: t });
                        uploadFile(file);
                        return;
                    }
                }
            }
            frappe.msgprint("No se encontro imagen en el portapapeles");
        } catch (err) {
            frappe.msgprint("No se pudo leer el portapapeles");
        }
    };

    function handleFileInput(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        uploadFile(file);
        e.target.value = "";
    }

    function uploadFile(file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("is_private", 0);
        fd.append("folder", "Home/Attachments");

        fetch("/api/method/upload_file", {
            method: "POST",
            headers: { "X-Frappe-CSRF-Token": frappe.csrf_token },
            body: fd
        })
            .then((r) => r.json())
            .then((data) => {
                if (data.message?.file_url) {
                    pendingAttachment = { archivo: data.message.file_url };
                    fillSelect("gdAttachCatSelect", categoriasAdjuntos, "Seleccione...");
                    document.getElementById("gdAttachCatModal").classList.add("open");
                } else {
                    frappe.msgprint("Error al subir archivo");
                }
            })
            .catch(() => frappe.msgprint("Error al subir archivo"));
    }

    window.gdConfirmAttachCat = function () {
        if (!pendingAttachment) return;
        const categoria = document.getElementById("gdAttachCatSelect").value;
        if (!categoria) {
            frappe.msgprint("Seleccione una categoria");
            return;
        }
        currentAttachments.push({ categoria, archivo: pendingAttachment.archivo });
        pendingAttachment = null;
        renderAttachments();
        document.getElementById("gdAttachCatModal").classList.remove("open");
    };

    window.gdCloseAttachCatModal = function () {
        pendingAttachment = null;
        document.getElementById("gdAttachCatModal").classList.remove("open");
    };

    window.gdRemoveAttachment = function (idx) {
        currentAttachments.splice(idx, 1);
        renderAttachments();
    };

    window.gdOpenCatalogModal = function (doctype) {
        if (!CATALOG_UI[doctype]) return;
        currentCatalogDoctype = doctype;
        document.getElementById("gdCatalogSwitcher").value = doctype;
        document.getElementById("gdCatalogTitle").textContent = "Gestionar: " + CATALOG_UI[doctype].label;
        document.getElementById("gdCatalogForm").classList.add("d-none");
        document.getElementById("gdCatalogForm").innerHTML = "";
        document.getElementById("gdCatalogModal").classList.add("open");
        loadCatalogList();
    };

    window.gdCloseCatalogModal = function () {
        document.getElementById("gdCatalogModal").classList.remove("open");
        currentCatalogDoctype = null;
        currentCatalogRows = [];
    };

    window.gdChangeCatalogInModal = function (doctype) {
        gdOpenCatalogModal(doctype);
    };

    function loadCatalogList() {
        if (!currentCatalogDoctype) return;
        frappe.call({
            method: API.catList,
            args: { doctype: currentCatalogDoctype },
            callback: (r) => {
                if (r.message?.status === "success") {
                    currentCatalogRows = r.message.rows || [];
                    renderCatalogList();
                } else {
                    document.getElementById("gdCatalogList").innerHTML =
                        `<div class="gd-empty" style="padding:20px;">${r.message?.message || "Error"}</div>`;
                }
            }
        });
    }

    function renderCatalogList() {
        const container = document.getElementById("gdCatalogList");
        container.innerHTML = "";
        if (!currentCatalogRows.length) {
            container.innerHTML = '<div class="gd-empty" style="padding:20px;">Sin registros</div>';
            return;
        }

        currentCatalogRows.forEach((row) => {
            const item = document.createElement("div");
            item.className = "gd-catalog-item";

            const meta = [];
            if ("activo" in row) {
                meta.push(
                    row.activo
                        ? '<span class="gd-badge gd-badge-active">Activo</span>'
                        : '<span class="gd-badge gd-badge-inactive">Inactivo</span>'
                );
            }
            if (row.descripcion) {
                meta.push(`<span>${escapeHtml(row.descripcion)}</span>`);
            }

            item.innerHTML = `
                <div class="gd-catalog-item-info">
                    <div class="gd-catalog-item-name">${escapeHtml(row.name)}</div>
                    ${meta.length ? `<div class="gd-catalog-item-meta">${meta.join("")}</div>` : ""}
                </div>
                ${CAN_EDIT ? `
                <div class="gd-catalog-actions">
                    <button title="Editar" onclick="gdEditCatalogEntry('${encodeURIComponent(row.name)}')">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="gd-catalog-del" title="Eliminar" onclick="gdDeleteCatalogEntry('${encodeURIComponent(row.name)}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>` : ""}
            `;
            container.appendChild(item);
        });
    }

    window.gdEditCatalogEntry = function (nameEnc) {
        const name = decodeURIComponent(nameEnc);
        const row = currentCatalogRows.find((r) => r.name === name);
        if (!row) return;
        gdRenderCatalogForm(row);
    };

    window.gdRenderCatalogForm = function (record) {
        if (!CAN_EDIT || !currentCatalogDoctype) return;
        const cfg = CATALOG_UI[currentCatalogDoctype];
        const isEdit = !!record;
        const container = document.getElementById("gdCatalogForm");
        const currentName = record ? record.name : "";

        let html = `<h6>${isEdit ? "Editar registro" : "Nuevo registro"}</h6>`;
        cfg.fields.forEach((field) => {
            const current = record ? (field.name === "nombre" ? record.name : record[field.name]) : (field.default ?? "");
            html += '<div class="gd-cf-row">';
            if (field.type === "check") {
                html += `<div class="gd-cf-check">
                    <input type="checkbox" id="gdCf_${field.name}" ${current ? "checked" : ""}>
                    <label for="gdCf_${field.name}" class="gd-label" style="margin:0;">${field.label}</label>
                </div>`;
            } else if (field.type === "textarea") {
                html += `<label class="gd-label">${field.label}${field.required ? " *" : ""}</label>
                    <textarea id="gdCf_${field.name}" class="form-control" rows="2">${escapeHtml(current || "")}</textarea>`;
            } else {
                html += `<label class="gd-label">${field.label}${field.required ? " *" : ""}</label>
                    <input type="text" id="gdCf_${field.name}" class="form-control" value="${escapeHtml(current || "")}">`;
            }
            html += "</div>";
        });

        html += `
            <div class="gd-cf-actions">
                <button type="button" class="gd-btn-primary-full" onclick="gdSaveCatalogEntry('${encodeURIComponent(currentName)}')">
                    <i class="fas fa-save"></i> Guardar
                </button>
                <button type="button" class="gd-btn-light-full" onclick="gdCancelCatalogForm()">Cancelar</button>
            </div>
        `;

        container.innerHTML = html;
        container.classList.remove("d-none");
    };

    window.gdCancelCatalogForm = function () {
        const container = document.getElementById("gdCatalogForm");
        container.classList.add("d-none");
        container.innerHTML = "";
    };

    window.gdSaveCatalogEntry = function (currentNameEnc) {
        if (!CAN_EDIT || !currentCatalogDoctype) return;
        const cfg = CATALOG_UI[currentCatalogDoctype];
        const currentName = decodeURIComponent(currentNameEnc || "");
        const payload = {};
        if (currentName) payload.name = currentName;

        for (const field of cfg.fields) {
            const el = document.getElementById("gdCf_" + field.name);
            if (!el) continue;
            if (field.type === "check") {
                payload[field.name] = el.checked ? 1 : 0;
            } else {
                const value = (el.value || "").trim();
                if (field.required && !value) {
                    frappe.msgprint(`El campo ${field.label} es requerido`);
                    return;
                }
                payload[field.name] = value;
            }
        }

        frappe.call({
            method: API.catSave,
            args: { doctype: currentCatalogDoctype, data: JSON.stringify(payload) },
            callback: (r) => {
                if (r.message?.status === "success") {
                    frappe.show_alert({
                        message: r.message.created ? "Registro creado" : "Registro actualizado",
                        indicator: "green"
                    });
                    gdCancelCatalogForm();
                    loadCatalogList();
                    loadInitialData();
                } else {
                    frappe.msgprint("Error: " + (r.message?.message || "no se pudo guardar"));
                }
            }
        });
    };

    window.gdDeleteCatalogEntry = function (nameEnc) {
        if (!CAN_EDIT || !currentCatalogDoctype) return;
        const name = decodeURIComponent(nameEnc);
        frappe.confirm(`¿Eliminar "${name}"?`, () => {
            frappe.call({
                method: API.catDel,
                args: { doctype: currentCatalogDoctype, name },
                callback: (r) => {
                    if (r.message?.status === "success") {
                        frappe.show_alert({ message: "Eliminado", indicator: "red" });
                        loadCatalogList();
                        loadInitialData();
                    } else {
                        let msg = r.message?.message || "No se pudo eliminar";
                        if (r.message?.in_use?.length) {
                            msg += "<ul>";
                            r.message.in_use.forEach((u) => {
                                msg += `<li>${u.doctype} · ${u.field}: <b>${u.count}</b></li>`;
                            });
                            msg += "</ul>";
                        }
                        frappe.msgprint({ title: "No se puede eliminar", message: msg, indicator: "red" });
                    }
                }
            });
        });
    };

    function wizardRender() {
        const root = document.querySelector(WIZARD.rootSelector);
        if (!root) return;

        root.querySelectorAll(".gd-wizard-step-indicator").forEach((el) => {
            const step = parseInt(el.dataset.step, 10);
            el.classList.toggle("active", step === WIZARD.currentStep);
            el.classList.toggle("done", step < WIZARD.currentStep);
        });

        root.querySelectorAll(".gd-wizard-pane").forEach((el) => {
            el.classList.toggle("active", parseInt(el.dataset.step, 10) === WIZARD.currentStep);
        });

        const backBtn = document.getElementById(WIZARD.backBtnId);
        const nextBtn = document.getElementById(WIZARD.nextBtnId);
        const saveBtn = document.getElementById(WIZARD.saveBtnId);
        const isLast = WIZARD.currentStep === WIZARD.totalSteps;

        if (backBtn) backBtn.style.display = WIZARD.currentStep > 1 ? "flex" : "none";
        if (nextBtn) nextBtn.style.display = isLast ? "none" : "flex";
        if (saveBtn) saveBtn.style.display = (isLast && CAN_EDIT) ? "flex" : "none";
    }

    window.gdWizardNext = function () {
        if (!WIZARD.validateStep(WIZARD.currentStep)) return;
        if (WIZARD.currentStep < WIZARD.totalSteps) {
            WIZARD.currentStep += 1;
            wizardRender();
        }
    };

    window.gdWizardPrev = function () {
        if (WIZARD.currentStep > 1) {
            WIZARD.currentStep -= 1;
            wizardRender();
        }
    };

    window.gdWizardGoTo = function (step) {
        if (step < WIZARD.currentStep) {
            WIZARD.currentStep = step;
            wizardRender();
            return;
        }
        for (let currentStep = WIZARD.currentStep; currentStep < step; currentStep += 1) {
            if (!WIZARD.validateStep(currentStep)) return;
        }
        WIZARD.currentStep = step;
        wizardRender();
    };

    function wizardReset() {
        WIZARD.currentStep = 1;
        wizardRender();
    }

    function fillSelect(id, items, placeholder) {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = "";
        const firstOption = document.createElement("option");
        firstOption.value = "";
        firstOption.textContent = placeholder;
        sel.appendChild(firstOption);
        (items || []).forEach((value) => {
            const option = document.createElement("option");
            option.value = typeof value === "string" ? value : (value.name || value);
            option.textContent = typeof value === "string" ? value : (value.name || value);
            sel.appendChild(option);
        });
        if (current) sel.value = current;
    }

    function setSelectValue(id, val) {
        const sel = document.getElementById(id);
        if (sel) sel.value = val || "";
    }

    function fmt(n) {
        const value = parseFloat(n || 0);
        return "S/ " + value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(d) {
        if (!d) return "-";
        try {
            let dt;
            const m = typeof d === "string" && d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m) {
                dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            } else {
                dt = new Date(d);
            }
            if (!Number.isNaN(dt.getTime())) {
                return dt.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
            }
        } catch (e) {
            // no-op
        }
        return d;
    }

    function escapeHtml(str) {
        if (str == null) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // ========= Pedidos vinculados (multi-seleccion) =========

    let pedidoTipoActivo = "Sales Invoice";
    let pedidoSearchTimer = null;
    let pedidosSeleccionados = [];

    function renderPedidoChips() {
        const cont = document.getElementById("gdPedidoChips");
        if (!cont) return;
        if (!pedidosSeleccionados.length) { cont.innerHTML = ""; return; }
        cont.innerHTML = pedidosSeleccionados.map((p, idx) => {
            const label = p.tipo === "Sales Invoice" ? "Factura" : "Borrador";
            const cliente = p.cliente ? ` · ${escapeHtml(p.cliente)}` : "";
            const monto = p.monto ? ` · S/ ${Number(p.monto).toFixed(2)}` : "";
            return `<span class="gd-pedido-chip">
                <span class="gd-pedido-chip-label">${label}: <b>${escapeHtml(p.name)}</b>${cliente}${monto}</span>
                <button type="button" class="gd-pedido-chip-x" onclick="gdRemovePedido(${idx})" title="Quitar"><i class="fas fa-times"></i></button>
            </span>`;
        }).join("");
    }

    function addPedidoToSelection(tipo, name, info) {
        if (!tipo || !name) return;
        if (pedidosSeleccionados.some(p => p.tipo === tipo && p.name === name)) return;
        pedidosSeleccionados.push({
            tipo,
            name,
            cliente: (info && info.customer_name) || "",
            monto: Number((info && info.grand_total) || 0)
        });
        renderPedidoChips();
    }

    function clearAllPedidos() {
        pedidosSeleccionados = [];
        pedidoTipoActivo = "Sales Invoice";
        const search = document.getElementById("gdPedidoSearch");
        if (search) { search.value = ""; }
        const results = document.getElementById("gdPedidoResults");
        if (results) { results.style.display = "none"; results.innerHTML = ""; }
        document.querySelectorAll(".gd-pedido-tipo-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.tipo === "Sales Invoice");
        });
        renderPedidoChips();
    }

    function setPedidosFromList(list) {
        pedidosSeleccionados = (list || [])
            .filter(p => p && p.pedido_tipo && p.pedido)
            .map(p => ({
                tipo: p.pedido_tipo,
                name: p.pedido,
                cliente: p.cliente || "",
                monto: Number(p.monto || 0)
            }));
        renderPedidoChips();
    }

    window.gdRemovePedido = function (idx) {
        if (idx < 0 || idx >= pedidosSeleccionados.length) return;
        pedidosSeleccionados.splice(idx, 1);
        renderPedidoChips();
    };

    function renderPedidoResults(rows) {
        const results = document.getElementById("gdPedidoResults");
        if (!results) return;
        if (!rows || !rows.length) {
            results.innerHTML = '<div class="gd-pedido-empty">Sin resultados</div>';
            results.style.display = "";
            return;
        }
        results.innerHTML = rows.map((r) => {
            const cliente = escapeHtml(r.customer_name || "");
            const monto = r.grand_total ? `S/ ${Number(r.grand_total).toFixed(2)}` : "";
            const fecha = escapeHtml(r.fecha || "");
            const courier = r.custom_courier ? escapeHtml(r.custom_courier) : "";
            const tienda = r.custom_tienda ? escapeHtml(r.custom_tienda) : "";
            const tel = r.direccion_telefono ? escapeHtml(r.direccion_telefono) : "";
            const dirRaw = r.direccion_texto ? String(r.direccion_texto) : "";
            const dir = dirRaw.length > 45 ? escapeHtml(dirRaw.slice(0, 45) + "…") : escapeHtml(dirRaw);
            const meta3 = (courier || tienda)
                ? `<div class="gd-pedido-meta"><i class="fas fa-truck"></i> ${courier || "—"}${tienda ? ' · <i class="fas fa-store"></i> ' + tienda : ""}</div>`
                : "";
            const meta4 = (tel || dir)
                ? `<div class="gd-pedido-meta">${tel ? '<i class="fas fa-phone"></i> ' + tel : ""}${tel && dir ? " · " : ""}${dir ? '<i class="fas fa-map-marker-alt"></i> ' + dir : ""}</div>`
                : "";
            return `
                <div class="gd-pedido-result" data-name="${escapeHtml(r.name)}"
                     data-cliente="${cliente}" data-monto="${r.grand_total || 0}">
                    <div class="gd-pedido-result-top"><b>${escapeHtml(r.name)}</b> <span>${cliente}</span></div>
                    <div class="gd-pedido-result-bot"><span>${fecha}</span> <span>${monto}</span></div>
                    ${meta3}
                    ${meta4}
                </div>
            `;
        }).join("");
        results.style.display = "";
        gdPositionPedidoDropdown();
        results.querySelectorAll(".gd-pedido-result").forEach((el) => {
            el.addEventListener("click", () => {
                addPedidoToSelection(pedidoTipoActivo, el.dataset.name, {
                    customer_name: el.dataset.cliente,
                    grand_total: Number(el.dataset.monto) || 0
                });
                const search = document.getElementById("gdPedidoSearch");
                if (search) { search.value = ""; search.focus(); }
                const r = document.getElementById("gdPedidoResults");
                if (r) { r.style.display = "none"; r.innerHTML = ""; }
            });
        });
    }

    function gdPositionPedidoDropdown() {
        const results = document.getElementById("gdPedidoResults");
        const input = document.getElementById("gdPedidoSearch");
        if (!results || !input) return;
        const inputRect = input.getBoundingClientRect();
        const vh = window.innerHeight;
        const spaceBelow = vh - inputRect.bottom - 12;
        const spaceAbove = inputRect.top - 12;
        if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
            results.style.top = "calc(100% + 4px)";
            results.style.bottom = "auto";
            results.style.maxHeight = Math.min(340, Math.max(160, spaceBelow)) + "px";
        } else {
            results.style.top = "auto";
            results.style.bottom = "calc(100% + 4px)";
            results.style.maxHeight = Math.min(340, Math.max(160, spaceAbove)) + "px";
        }
    }

    function doPedidoSearch(q) {
        const query = (q || "").trim();
        const limit = query.length >= 2 ? 15 : 5;
        frappe.call({
            method: API.searchPedidos,
            args: { tipo: pedidoTipoActivo, q: query, limit },
            callback: (r) => {
                if (r.message?.status === "success") {
                    renderPedidoResults(r.message.rows || []);
                }
            }
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".gd-pedido-tipo-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                pedidoTipoActivo = btn.dataset.tipo;
                document.querySelectorAll(".gd-pedido-tipo-btn").forEach((b) => b.classList.toggle("active", b === btn));
                const search = document.getElementById("gdPedidoSearch");
                doPedidoSearch(search ? search.value.trim() : "");
            });
        });
        const search = document.getElementById("gdPedidoSearch");
        if (search) {
            search.addEventListener("input", (e) => {
                clearTimeout(pedidoSearchTimer);
                const v = e.target.value.trim();
                pedidoSearchTimer = setTimeout(() => doPedidoSearch(v), 250);
            });
            search.addEventListener("focus", () => {
                doPedidoSearch(search.value.trim());
            });
        }
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".gd-pedido-wrap")) {
                const results = document.getElementById("gdPedidoResults");
                if (results) results.style.display = "none";
            }
        });
    });
})();
