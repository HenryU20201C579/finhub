(function () {
    'use strict';

    const state = {
        startDate: null,
        endDate: null,
        data: null,
    };

    // ==========================================================
    // UTILS
    // ==========================================================
    const fmtMoney = (v) => {
        const num = Number(v || 0);
        const sign = num < 0 ? '-' : '';
        return sign + 'S/. ' + Math.abs(num).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const fmtPct = (v) => (Number(v || 0)).toFixed(2) + '%';
    const fmtDate = (d) => {
        const dt = (d instanceof Date) ? d : new Date(d + 'T00:00:00');
        if (isNaN(dt.getTime())) return '';
        return dt.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    // ==========================================================
    // DATE PRESETS
    // ==========================================================
    function getPresetRange(preset) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let start, end;
        if (preset === 'este-mes') {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        } else if (preset === 'mes-pasado') {
            start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            end = new Date(today.getFullYear(), today.getMonth(), 0);
        } else if (preset === 'este-trimestre') {
            const q = Math.floor(today.getMonth() / 3);
            start = new Date(today.getFullYear(), q * 3, 1);
            end = new Date(today.getFullYear(), q * 3 + 3, 0);
        } else if (preset === 'este-año') {
            start = new Date(today.getFullYear(), 0, 1);
            end = new Date(today.getFullYear(), 11, 31);
        }
        return { start, end };
    }

    function toISODate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function updateRangeLabel() {
        const lbl = document.getElementById('erRangeLabel');
        if (!state.startDate || !state.endDate) return;
        lbl.textContent = `${fmtDate(state.startDate)} — ${fmtDate(state.endDate)}`;
    }

    // ==========================================================
    // RENDER
    // ==========================================================
    function renderKPIs(d) {
        document.getElementById('kpiIngresosNetos').textContent = fmtMoney(d.resumen.ingresos_netos);
        document.getElementById('kpiUtilidadBruta').textContent = fmtMoney(d.resumen.utilidad_bruta);
        document.getElementById('kpiUtilidadBrutaPct').textContent = fmtPct(d.porcentajes.utilidad_bruta) + ' margen bruto';
        document.getElementById('kpiUtilidadOp').textContent = fmtMoney(d.resumen.utilidad_operacion);
        document.getElementById('kpiUtilidadOpPct').textContent = fmtPct(d.porcentajes.utilidad_operacion) + ' margen operativo';
        document.getElementById('kpiUtilidadNeta').textContent = fmtMoney(d.resumen.utilidad_neta);
        document.getElementById('kpiUtilidadNetaPct').textContent = fmtPct(d.porcentajes.utilidad_neta) + ' margen neto';

        // Trend
        const trendEl = document.getElementById('kpiTrend');
        const t = d.comparativa.trend_ingresos_pct;
        if (t > 0) {
            trendEl.className = 'er-kpi-trend up';
            trendEl.innerHTML = `<i data-lucide="trending-up"></i> +${fmtPct(t)} vs periodo anterior`;
        } else if (t < 0) {
            trendEl.className = 'er-kpi-trend down';
            trendEl.innerHTML = `<i data-lucide="trending-down"></i> ${fmtPct(t)} vs periodo anterior`;
        } else {
            trendEl.innerHTML = '';
        }
    }

    function renderPLTable(d) {
        const tbody = document.getElementById('erPlBody');
        const r = d.resumen;
        const p = d.porcentajes;

        const ventasSubLabel = r.ventas_brutas_con_igv
            ? `<span class="pl-sublabel">Con IGV: ${fmtMoney(r.ventas_brutas_con_igv)} · IGV: ${fmtMoney(r.igv_sobre_ventas || 0)}</span>`
            : '';

        const rows = [
            { label: `Ventas brutas${ventasSubLabel}`, amount: r.ventas_brutas, pct: 100 + (p.descuentos + p.devoluciones), cls: '', concept: 'ventas_brutas' },
            { label: '(−) Descuentos', amount: -r.descuentos, pct: -p.descuentos, cls: 'pl-negative', indent: true, concept: 'descuentos' },
            { label: '(−) Devoluciones', amount: -r.devoluciones, pct: -p.devoluciones, cls: 'pl-negative', indent: true, concept: 'devoluciones' },
            { label: 'Ingresos Netos', amount: r.ingresos_netos, pct: 100, cls: 'pl-subtotal', concept: 'ingresos_netos' },
            { label: '(−) Costo de Ventas (COGS)', amount: -r.costo_ventas, pct: -p.costo_ventas, cls: 'pl-negative', concept: 'costo_ventas' },
            { label: 'Utilidad Bruta', amount: r.utilidad_bruta, pct: p.utilidad_bruta, cls: 'pl-subtotal', concept: 'utilidad_bruta' },
            { label: '(−) Gastos de Operacion', amount: -r.gastos_operacion, pct: -p.gastos_operacion, cls: 'pl-negative', concept: 'gastos_operacion' },
            { label: 'Utilidad de Operacion', amount: r.utilidad_operacion, pct: p.utilidad_operacion, cls: 'pl-subtotal', concept: 'utilidad_operacion' },
            { label: '(−) Gastos Extraordinarios', amount: -r.gastos_extraordinarios, pct: -p.gastos_extraordinarios, cls: 'pl-negative', concept: 'gastos_extraordinarios' },
            { label: 'Utilidad antes de Impuestos', amount: r.utilidad_antes_impuestos, pct: (r.utilidad_antes_impuestos / r.ingresos_netos * 100) || 0, cls: 'pl-subtotal', concept: 'utilidad_antes_impuestos' },
            { label: '(−) Impuesto a la Renta (1.5%)', amount: -r.impuesto_renta, pct: -p.impuesto_renta, cls: 'pl-negative', concept: 'impuesto_renta' },
            { label: 'Utilidad Neta', amount: r.utilidad_neta, pct: p.utilidad_neta, cls: 'pl-total', concept: 'utilidad_neta' },
        ];

        tbody.innerHTML = rows.map(row => `
            <tr class="${row.cls || ''}${row.indent ? ' pl-indent' : ''} pl-clickable" data-concept="${row.concept}">
                <td class="td-concept">${row.label} <i data-lucide="chevron-right" class="pl-chev"></i></td>
                <td class="td-amount">${fmtMoney(row.amount)}</td>
                <td class="td-pct">${fmtPct(row.pct)}</td>
            </tr>
        `).join('');
    }

    function renderGastos(d) {
        const grid = document.getElementById('erGastosGrid');
        if (!d.gastos_detalle || d.gastos_detalle.length === 0) {
            grid.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:8px;margin:0;">No hay gastos registrados en este periodo.</p>';
            return;
        }
        grid.innerHTML = d.gastos_detalle.map(g => `
            <div class="er-gasto-card" data-grupo="${g.label}">
                <div class="er-gasto-label">${g.label}</div>
                <div class="er-gasto-amount">${fmtMoney(g.monto)}</div>
                <div class="er-gasto-pct">${fmtPct(g.pct)} de ingresos netos</div>
                <div class="er-gasto-count">${g.count} movimiento${g.count !== 1 ? 's' : ''} · Click para ver</div>
            </div>
        `).join('');
    }

    function renderAll(d) {
        document.getElementById('erPlPeriod').textContent = `${fmtDate(d.period.start)} — ${fmtDate(d.period.end)}`;
        renderKPIs(d);
        renderPLTable(d);
        renderGastos(d);
        // Re-init lucide icons after DOM updates
        if (window.lucide) window.lucide.createIcons();
    }

    // ==========================================================
    // DATA LOADING
    // ==========================================================
    function loadData() {
        document.getElementById('erLoader').classList.remove('d-none');
        document.getElementById('erMain').classList.add('d-none');
        document.getElementById('erError').classList.add('d-none');

        frappe.call({
            method: 'finhub.www.estado_resultados.index.get_estado_resultados',
            args: {
                start_date: toISODate(state.startDate),
                end_date: toISODate(state.endDate),
            },
            callback: function (r) {
                document.getElementById('erLoader').classList.add('d-none');
                if (r.message && r.message.status === 'success') {
                    state.data = r.message;
                    document.getElementById('erMain').classList.remove('d-none');
                    renderAll(r.message);
                } else {
                    const errEl = document.getElementById('erError');
                    const msgEl = document.getElementById('erErrorMsg');
                    msgEl.textContent = r.message ? r.message.message : 'Error desconocido al cargar el Estado de Resultados';
                    errEl.classList.remove('d-none');
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        });
    }

    // ==========================================================
    // POPOVER
    // ==========================================================
    function openPopover() {
        document.getElementById('erPopover').classList.remove('d-none');
        document.getElementById('erDateFrom').value = toISODate(state.startDate);
        document.getElementById('erDateTo').value = toISODate(state.endDate);
    }

    function closePopover() {
        document.getElementById('erPopover').classList.add('d-none');
    }

    function applyPreset(preset) {
        document.querySelectorAll('.er-presets button').forEach(b => b.classList.remove('active'));
        document.querySelector(`.er-presets button[data-preset="${preset}"]`).classList.add('active');
        if (preset === 'custom') return;
        const { start, end } = getPresetRange(preset);
        document.getElementById('erDateFrom').value = toISODate(start);
        document.getElementById('erDateTo').value = toISODate(end);
    }

    // ==========================================================
    // INIT
    // ==========================================================
    document.addEventListener('DOMContentLoaded', function () {
        if (window.lucide) window.lucide.createIcons();

        // Default: este mes
        const { start, end } = getPresetRange('este-mes');
        state.startDate = start;
        state.endDate = end;
        updateRangeLabel();
        loadData();

        // Range button
        document.getElementById('erRangeBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const pop = document.getElementById('erPopover');
            if (pop.classList.contains('d-none')) openPopover(); else closePopover();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            const pop = document.getElementById('erPopover');
            const btn = document.getElementById('erRangeBtn');
            if (!pop.classList.contains('d-none') && !pop.contains(e.target) && !btn.contains(e.target)) {
                closePopover();
            }
        });

        // Presets
        document.querySelectorAll('.er-presets button').forEach(btn => {
            btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
        });

        // Cancel / Apply
        document.getElementById('erCancelRange').addEventListener('click', closePopover);
        document.getElementById('erApplyRange').addEventListener('click', () => {
            const from = document.getElementById('erDateFrom').value;
            const to = document.getElementById('erDateTo').value;
            if (!from || !to) {
                frappe.msgprint({ title: 'Fechas invalidas', indicator: 'orange', message: 'Selecciona ambas fechas.' });
                return;
            }
            state.startDate = new Date(from + 'T00:00:00');
            state.endDate = new Date(to + 'T00:00:00');
            closePopover();
            updateRangeLabel();
            loadData();
        });

        // Print
        document.getElementById('erPrintBtn').addEventListener('click', () => window.print());

        // ====== DRAWER (detalle KPI) ======
        const drawer = document.getElementById('erDrawer');
        const overlay = document.getElementById('erDrawerOverlay');
        const drawerClose = document.getElementById('erDrawerClose');

        function closeDrawer() {
            drawer.classList.remove('open');
            overlay.classList.remove('open');
        }
        drawerClose.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

        document.querySelectorAll('.er-kpi-card').forEach(card => {
            card.addEventListener('click', () => {
                const kpi = card.dataset.kpi;
                if (!kpi) return;
                openKpiDetail(kpi);
            });
        });

        // Click en filas de tabla P&L
        document.addEventListener('click', (e) => {
            const row = e.target.closest('tr.pl-clickable');
            if (row && row.dataset.concept) {
                openConceptDetail(row.dataset.concept);
                return;
            }
            const gastoCard = e.target.closest('.er-gasto-card');
            if (gastoCard && gastoCard.dataset.grupo) {
                openGrupoDetail(gastoCard.dataset.grupo);
                return;
            }
        });

        // Collapse/expand subsections
        document.addEventListener('click', (e) => {
            const title = e.target.closest('.er-drawer-subsection-title');
            if (title) {
                title.parentElement.classList.toggle('open');
            }
        });
    });

    // ==========================================================
    // DRAWER DETALLE KPI
    // ==========================================================
    function openKpiDetail(kpiType) {
        const drawer = document.getElementById('erDrawer');
        const overlay = document.getElementById('erDrawerOverlay');
        const body = document.getElementById('erDrawerBody');
        const title = document.getElementById('erDrawerTitle');

        title.textContent = 'Cargando detalle...';
        body.innerHTML = '<div class="er-loader"><div class="er-spinner"></div><p>Cargando registros...</p></div>';
        drawer.classList.add('open');
        overlay.classList.add('open');

        frappe.call({
            method: 'finhub.www.estado_resultados.index.get_kpi_detail',
            args: {
                kpi_type: kpiType,
                start_date: toISODate(state.startDate),
                end_date: toISODate(state.endDate),
            },
            callback: function (r) {
                if (r.message && r.message.status === 'success') {
                    title.textContent = r.message.title;
                    body.innerHTML = renderKpiDetail(r.message);
                    if (window.lucide) window.lucide.createIcons();
                } else {
                    body.innerHTML = `<div class="er-error"><i data-lucide="alert-circle"></i><p>${r.message ? r.message.message : 'Error al cargar detalle'}</p></div>`;
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        });
    }

    function renderKpiDetail(d) {
        switch (d.kpi) {
            case 'ingresos_netos': return renderIngresosDetail(d);
            case 'utilidad_bruta': return renderUtilidadBrutaDetail(d);
            case 'utilidad_operacion': return renderUtilidadOperacionDetail(d);
            case 'utilidad_neta': return renderUtilidadNetaDetail(d);
        }
        return '<p>Sin detalle disponible.</p>';
    }

    // ========== CONCEPT DETAIL (filas tabla P&L) ==========
    function openConceptDetail(concept) {
        const drawer = document.getElementById('erDrawer');
        const overlay = document.getElementById('erDrawerOverlay');
        const body = document.getElementById('erDrawerBody');
        const title = document.getElementById('erDrawerTitle');

        title.textContent = 'Cargando detalle...';
        body.innerHTML = '<div class="er-loader"><div class="er-spinner"></div><p>Cargando...</p></div>';
        drawer.classList.add('open');
        overlay.classList.add('open');

        frappe.call({
            method: 'finhub.www.estado_resultados.index.get_concept_detail',
            args: { concept: concept, start_date: toISODate(state.startDate), end_date: toISODate(state.endDate) },
            callback: function (r) {
                if (r.message && r.message.status === 'success') {
                    title.textContent = r.message.title;
                    body.innerHTML = renderConceptDetail(r.message);
                    if (window.lucide) window.lucide.createIcons();
                } else {
                    body.innerHTML = `<div class="er-error"><i data-lucide="alert-circle"></i><p>${r.message ? r.message.message : 'Error'}</p></div>`;
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        });
    }

    function renderConceptDetail(d) {
        // KPIs con render especifico
        if (['ingresos_netos', 'utilidad_bruta', 'utilidad_operacion', 'utilidad_neta'].includes(d.concept)) {
            return renderKpiDetail({ ...d, kpi: d.concept });
        }
        // Render generico por tipo
        switch (d.concept) {
            case 'ventas_brutas': return renderVentasBrutasDetail(d);
            case 'descuentos': return renderDescuentosDetail(d);
            case 'devoluciones': return renderDevolucionesDetail(d);
            case 'costo_ventas': return renderCostoVentasDetail(d);
            case 'gastos_operacion': return renderUtilidadOperacionDetail({ ...d, kpi: 'utilidad_operacion' });
            case 'gastos_extraordinarios': return renderGastosExtraDetail(d);
            case 'utilidad_antes_impuestos': return renderBreakdownDetail(d);
            case 'impuesto_renta': return renderImpuestoRentaDetail(d);
        }
        return renderGenericDetail(d);
    }

    function renderGenericDetail(d) {
        return renderFormula(d.formula || '') +
               `<div class="er-drawer-explain">${d.explain || 'Sin explicacion.'}</div>`;
    }

    function renderVentasBrutasDetail(d) {
        const t = d.totales;
        const conIgv = t.total_con_igv || t.total;
        const sinIgv = t.total_sin_igv || t.total;
        const igv = t.igv || 0;
        const stats = `<div class="er-drawer-totales">
            ${renderStat('Ventas Sin IGV (P&L)', fmtMoney(sinIgv), 'positive')}
            ${renderStat('Ventas Con IGV (BD)', fmtMoney(conIgv), 'muted')}
            ${renderStat('IGV (18%)', fmtMoney(igv), 'muted')}
            ${renderStat('# Facturas', t.num_facturas)}
        </div>
        <div class="er-igv-note">
            <i data-lucide="info"></i>
            <span>Las facturas en la BD vienen <strong>con IGV (18%)</strong>. El P&L trabaja en <strong>base imponible</strong> (${fmtMoney(sinIgv)}) igual que el Excel de referencia del negocio, por eso se divide entre 1.18. La diferencia (<strong>${fmtMoney(igv)}</strong>) es el IGV que se paga a SUNAT (debito fiscal). En la tabla de abajo cada factura se muestra con su valor original (con IGV).</span>
        </div>`;
        const rows = d.facturas.map(f => `
            <tr>
                <td class="muted">${f.posting_date}</td>
                <td><strong>${f.name}</strong></td>
                <td>${f.customer_name || ''}</td>
                <td class="right">${fmtMoney(f.total)}</td>
                <td class="right muted">${fmtMoney(f.grand_total)}</td>
            </tr>`).join('');
        return renderFormula(d.formula) +
               `<div class="er-drawer-explain">${d.explain}</div>` + stats +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="receipt"></i>Facturas (${d.facturas.length})</h3>
                    <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                        <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th class="right">Subtotal</th><th class="right">Grand Total</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table></div>
                </div>`;
    }

    function renderDescuentosDetail(d) {
        const t = d.totales;
        const stats = `<div class="er-drawer-totales">
            ${renderStat('Total Descuentos', fmtMoney(t.total), 'negative')}
            ${renderStat('# Facturas con Descuento', t.num_facturas)}
        </div>`;
        const rows = d.facturas.map(f => `
            <tr>
                <td class="muted">${f.posting_date}</td>
                <td><strong>${f.name}</strong></td>
                <td>${f.customer_name || ''}</td>
                <td class="right">${fmtMoney(f.total)}</td>
                <td class="right neg">−${fmtMoney(f.discount_amount)}</td>
                <td class="right"><strong>${fmtMoney(f.grand_total)}</strong></td>
            </tr>`).join('');
        return renderFormula(d.formula) +
               `<div class="er-drawer-explain">${d.explain}</div>` + stats +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="scissors"></i>Facturas con descuento (${d.facturas.length})</h3>
                    <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                        <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th class="right">Total</th><th class="right">Descuento</th><th class="right">Neto</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table></div>
                </div>`;
    }

    function renderDevolucionesDetail(d) {
        const t = d.totales;
        const stats = `<div class="er-drawer-totales">
            ${renderStat('Total Devoluciones', fmtMoney(t.total), 'negative')}
            ${renderStat('Notas de Credito', fmtMoney(t.total_nc))}
            ${renderStat('Canceladas', fmtMoney(t.total_canceladas))}
            ${renderStat('# Notas Credito', t.num_nc)}
            ${renderStat('# Canceladas', t.num_canceladas)}
        </div>`;

        let ncHtml = '';
        if (d.returns && d.returns.length) {
            const rows = d.returns.map(r => `
                <tr>
                    <td class="muted">${r.posting_date}</td>
                    <td><strong>${r.name}</strong></td>
                    <td>${r.customer_name || ''}</td>
                    <td class="muted">${r.return_against || '—'}</td>
                    <td class="right neg"><strong>${fmtMoney(r.grand_total)}</strong></td>
                </tr>`).join('');
            ncHtml = `<div class="er-drawer-section">
                <h3><i data-lucide="file-minus"></i>Notas de Credito (${d.returns.length})</h3>
                <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                    <thead><tr><th>Fecha</th><th>NC</th><th>Cliente</th><th>Ref. Factura</th><th class="right">Monto</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>
            </div>`;
        }

        let cancHtml = '';
        if (d.canceladas && d.canceladas.length) {
            const rows = d.canceladas.map(c => `
                <tr>
                    <td class="muted">${c.posting_date}</td>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.customer_name || ''}</td>
                    <td class="muted">${c.cancel_date}</td>
                    <td class="right neg"><strong>${fmtMoney(c.grand_total)}</strong></td>
                </tr>`).join('');
            cancHtml = `<div class="er-drawer-section">
                <h3><i data-lucide="x-circle"></i>Facturas canceladas (${d.canceladas.length})</h3>
                <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                    <thead><tr><th>Fecha emision</th><th>Factura</th><th>Cliente</th><th>Fecha cancelacion</th><th class="right">Monto</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>
            </div>`;
        }

        return renderFormula(d.formula) +
               `<div class="er-drawer-explain">${d.explain}</div>` + stats + ncHtml + cancHtml;
    }

    function renderCostoVentasDetail(d) {
        const t = d.totales;
        const conIgv = t.total_con_igv || t.total;
        const sinIgv = t.total_sin_igv || t.total;
        const igv = t.igv || 0;
        const stats = `<div class="er-drawer-totales">
            ${renderStat('COGS Sin IGV (P&L)', fmtMoney(sinIgv), 'negative')}
            ${renderStat('COGS Con IGV (BD)', fmtMoney(conIgv), 'muted')}
            ${renderStat('IGV (18%)', fmtMoney(igv), 'muted')}
            ${renderStat('Costo Productos (sin IGV)', fmtMoney(t.total_productos || 0), 'negative')}
            ${renderStat('Costo Embalaje (sin IGV)', fmtMoney(t.total_embalaje || 0), 'negative')}
            ${renderStat('# SKUs', t.num_items)}
            ${renderStat('# Tipos de Caja', t.num_cajas || 0)}
        </div>
        <div class="er-igv-note">
            <i data-lucide="info"></i>
            <span>Los precios en <code>Item Price</code> (lista <code>Compra estandar</code>) y <code>Caja Pedido</code> vienen <strong>con IGV incluido (18%)</strong>. El P&L trabaja en <strong>base imponible</strong> (${fmtMoney(sinIgv)}) igual que el Excel de referencia del negocio. La diferencia (<strong>${fmtMoney(igv)}</strong>) es credito fiscal que se compensa con el IGV de ventas ante SUNAT.</span>
        </div>`;
        const rowsItems = d.items.map(i => `
            <tr>
                <td><strong>${i.item_name || i.item_code}</strong><br><span class="muted">${i.item_code}</span></td>
                <td class="right">${i.qty_total.toFixed(0)}</td>
                <td class="right muted">${fmtMoney(i.unit_cost)}</td>
                <td class="right neg"><strong>${fmtMoney(i.cogs_total)}</strong></td>
                <td class="right muted">${i.num_facturas}</td>
            </tr>`).join('');

        const cajas = d.cajas || [];
        const rowsCajas = cajas.map(c => `
            <tr>
                <td><strong>${c.caja || '—'}</strong></td>
                <td class="right">${(c.cantidad_total || 0).toFixed(0)}</td>
                <td class="right muted">${fmtMoney(c.precio_unitario)}</td>
                <td class="right neg"><strong>${fmtMoney(c.subtotal)}</strong></td>
                <td class="right muted">${c.num_ordenes}</td>
            </tr>`).join('');
        const cajasSection = cajas.length ? `
            <div class="er-drawer-section">
                <h3><i data-lucide="box"></i>Embalaje (Cajas asociadas) — Sin IGV: ${fmtMoney(t.total_embalaje || 0)} · Con IGV: ${fmtMoney(t.total_embalaje_con_igv || 0)}</h3>
                <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                    <thead><tr><th>Caja</th><th class="right">Cant.</th><th class="right">Precio Unit. (c/IGV)</th><th class="right">Subtotal (c/IGV)</th><th class="right"># Ordenes</th></tr></thead>
                    <tbody>${rowsCajas}</tbody>
                </table></div>
            </div>` : '';

        return renderFormula(d.formula) +
               `<div class="er-drawer-explain">${d.explain}</div>` + stats + cajasSection +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="package"></i>SKUs vendidos — Sin IGV: ${fmtMoney(t.total_productos || 0)} · Con IGV: ${fmtMoney(t.total_productos_con_igv || 0)}</h3>
                    <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                        <thead><tr><th>Producto</th><th class="right">Qty</th><th class="right">Costo Unit.</th><th class="right">COGS Total</th><th class="right"># Fact.</th></tr></thead>
                        <tbody>${rowsItems}</tbody>
                    </table></div>
                </div>`;
    }

    function renderGastosExtraDetail(d) {
        const t = d.totales;
        const stats = `<div class="er-drawer-totales">
            ${renderStat('Total Gastos Extra', fmtMoney(t.total), 'negative')}
            ${renderStat('# Movimientos', t.num_items)}
        </div>`;
        const rows = d.items.map(i => `
            <tr>
                <td class="muted">${i.fecha}</td>
                <td>${i.categoria || '—'}</td>
                <td>${i.descripcion || '—'}</td>
                <td class="muted">${i.caja_chica || '—'}</td>
                <td class="right neg"><strong>${fmtMoney(i.monto)}</strong></td>
            </tr>`).join('');
        return renderFormula(d.formula) +
               `<div class="er-drawer-explain">${d.explain}</div>` + stats +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="wallet"></i>Movimientos caja chica (${d.items.length})</h3>
                    <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                        <thead><tr><th>Fecha</th><th>Categoria</th><th>Descripcion</th><th>Caja</th><th class="right">Monto</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table></div>
                </div>`;
    }

    function renderBreakdownDetail(d) {
        const b = d.breakdown;
        const rows = Object.entries(b).map(([k, v]) => {
            const isNeg = k.startsWith('gastos_') || k.startsWith('impuesto_');
            const prefix = isNeg ? '(−) ' : '';
            return `<tr>
                <td>${prefix}${k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td>
                <td class="right ${isNeg ? 'neg' : ''}"><strong>${fmtMoney(isNeg ? -v : v)}</strong></td>
            </tr>`;
        }).join('');
        return renderFormula(d.formula) +
               `<div class="er-drawer-explain">${d.explain}</div>` +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="git-branch"></i>Desglose del calculo</h3>
                    <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                        <thead><tr><th>Concepto</th><th class="right">Monto</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table></div>
                </div>`;
    }

    function renderImpuestoRentaDetail(d) {
        const b = d.breakdown;
        return renderFormula(d.formula) +
               `<div class="er-drawer-explain">${d.explain}</div>` +
               `<div class="er-drawer-totales">
                    ${renderStat('Ingresos Netos', fmtMoney(b.ingresos_netos))}
                    ${renderStat('Porcentaje', b.porcentaje + '%')}
                    ${renderStat('Impuesto a pagar', fmtMoney(b.impuesto_renta), 'negative')}
                </div>
                <div class="er-drawer-explain" style="margin-top:16px;">
                    <strong>Calculo:</strong> ${fmtMoney(b.ingresos_netos)} × ${b.porcentaje}% = <strong>${fmtMoney(b.impuesto_renta)}</strong>
                </div>`;
    }

    // ========== GRUPO GASTO DETAIL (click en card de gasto) ==========
    function openGrupoDetail(grupoLabel) {
        const drawer = document.getElementById('erDrawer');
        const overlay = document.getElementById('erDrawerOverlay');
        const body = document.getElementById('erDrawerBody');
        const title = document.getElementById('erDrawerTitle');

        title.textContent = 'Cargando...';
        body.innerHTML = '<div class="er-loader"><div class="er-spinner"></div><p>Cargando...</p></div>';
        drawer.classList.add('open');
        overlay.classList.add('open');

        frappe.call({
            method: 'finhub.www.estado_resultados.index.get_gasto_grupo_detail',
            args: { grupo_label: grupoLabel, start_date: toISODate(state.startDate), end_date: toISODate(state.endDate) },
            callback: function (r) {
                if (r.message && r.message.status === 'success') {
                    title.textContent = 'Gasto: ' + r.message.grupo_label;
                    body.innerHTML = renderGrupoDetail(r.message);
                    if (window.lucide) window.lucide.createIcons();
                } else {
                    body.innerHTML = `<div class="er-error"><i data-lucide="alert-circle"></i><p>Error al cargar detalle</p></div>`;
                }
            }
        });
    }

    function renderGrupoDetail(d) {
        const statsHtml = `<div class="er-drawer-totales">
            ${renderStat('Total ' + d.grupo_label, fmtMoney(d.total), 'negative')}
            ${renderStat('# Movimientos', d.num_movimientos)}
            ${renderStat('# Categorias', d.categorias.length)}
        </div>`;

        const catRows = d.categorias.map(c => `
            <tr>
                <td><strong>${c.categoria}</strong></td>
                <td class="right muted">${c.count} mov.</td>
                <td class="right neg"><strong>${fmtMoney(c.monto)}</strong></td>
            </tr>`).join('');

        const itemRows = d.items.map(i => `
            <tr>
                <td class="muted">${i.fecha}</td>
                <td>${i.categoria}</td>
                <td>${i.descripcion || '—'}</td>
                <td class="muted">${i.proveedor || '—'}</td>
                <td class="right neg"><strong>${fmtMoney(i.monto)}</strong></td>
            </tr>`).join('');

        const explain = `
            <p>Aqui ves el desglose completo del grupo <strong>${d.grupo_label}</strong> en el periodo seleccionado.</p>
            <p>Primero un resumen por categoria (para entender de donde viene el gasto), y despues el detalle de cada movimiento individual.</p>
        `;

        return renderFormula('SUM(monto) de Finanzas Corporativas WHERE categoria mapea al grupo "' + d.grupo_label + '"') +
               `<div class="er-drawer-explain">${explain}</div>` + statsHtml +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="tag"></i>Por categoria (${d.categorias.length})</h3>
                    <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                        <thead><tr><th>Categoria</th><th class="right">Movs.</th><th class="right">Monto</th></tr></thead>
                        <tbody>${catRows}</tbody>
                    </table></div>
                </div>` +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="list"></i>Detalle individual (${d.items.length} movimientos)</h3>
                    <div class="er-drawer-table-wrap"><table class="er-drawer-table">
                        <thead><tr><th>Fecha</th><th>Categoria</th><th>Descripcion</th><th>Proveedor</th><th class="right">Monto</th></tr></thead>
                        <tbody>${itemRows}</tbody>
                    </table></div>
                </div>`;
    }

    function renderFormula(text) {
        return `
            <div class="er-drawer-formula">
                <div class="er-drawer-formula-label">Formula</div>
                <div class="er-drawer-formula-value">${text}</div>
            </div>`;
    }

    function renderStat(label, value, cls = '') {
        return `<div class="er-drawer-stat ${cls}">
            <div class="er-drawer-stat-label">${label}</div>
            <div class="er-drawer-stat-value">${value}</div>
        </div>`;
    }

    // ========== INGRESOS NETOS ==========
    function renderIngresosDetail(d) {
        const t = d.totales;
        const explain = `
            <p>Los <strong>Ingresos Netos</strong> son el resultado de lo que efectivamente queda despues de aplicar descuentos y descontar las devoluciones.</p>
            <p>Se calcula tomando todas las <strong>facturas emitidas</strong> (Sales Invoice con <code>docstatus=1</code>) en el periodo y restando sus descuentos y devoluciones.</p>
            <p>Las devoluciones incluyen tanto las <strong>notas de credito</strong> (Sales Invoice con <code>is_return=1</code>) como las <strong>facturas canceladas</strong> (<code>docstatus=2</code>) dentro del mes.</p>
        `;

        const statsHtml = `
            <div class="er-drawer-totales">
                ${renderStat('Ventas brutas', fmtMoney(t.ventas_brutas))}
                ${renderStat('Descuentos', fmtMoney(t.descuentos), 'negative')}
                ${renderStat('Devoluciones', fmtMoney(t.devoluciones), 'negative')}
                ${renderStat('Ingresos Netos', fmtMoney(t.ingresos_netos), 'positive')}
                ${renderStat('# Facturas', t.num_facturas)}
                ${renderStat('# Notas Credito', t.num_returns)}
                ${renderStat('# Canceladas', t.num_canceladas)}
            </div>`;

        let facturasHtml = '';
        if (d.facturas && d.facturas.length) {
            const rows = d.facturas.map(f => `
                <tr>
                    <td class="muted">${f.posting_date}</td>
                    <td><strong>${f.name}</strong>${f.is_return ? ' <span class="neg">(NC)</span>' : ''}</td>
                    <td>${f.customer_name || ''}</td>
                    <td class="right ${f.is_return ? 'neg' : ''}">${fmtMoney(f.total)}</td>
                    <td class="right neg">${fmtMoney(-f.discount_amount)}</td>
                    <td class="right"><strong>${fmtMoney(f.grand_total)}</strong></td>
                </tr>
            `).join('');
            facturasHtml = `
                <div class="er-drawer-section">
                    <h3><i data-lucide="receipt"></i>Facturas del periodo (${d.facturas.length})</h3>
                    <div class="er-drawer-table-wrap">
                        <table class="er-drawer-table">
                            <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th class="right">Total</th><th class="right">Descuento</th><th class="right">Neto</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        }

        let canceladasHtml = '';
        if (d.canceladas && d.canceladas.length) {
            const rows = d.canceladas.map(c => `
                <tr>
                    <td class="muted">${c.posting_date}</td>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.customer_name || ''}</td>
                    <td class="muted">${c.cancel_date}</td>
                    <td class="right neg">${fmtMoney(-c.grand_total)}</td>
                </tr>
            `).join('');
            canceladasHtml = `
                <div class="er-drawer-section">
                    <h3><i data-lucide="x-circle"></i>Facturas canceladas en el periodo (${d.canceladas.length})</h3>
                    <div class="er-drawer-table-wrap">
                        <table class="er-drawer-table">
                            <thead><tr><th>Fecha emision</th><th>Factura</th><th>Cliente</th><th>Fecha cancelacion</th><th class="right">Monto</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        }

        return renderFormula('Ventas Brutas − Descuentos − Devoluciones') +
               `<div class="er-drawer-explain">${explain}</div>` +
               statsHtml + facturasHtml + canceladasHtml;
    }

    // ========== UTILIDAD BRUTA ==========
    function renderUtilidadBrutaDetail(d) {
        const t = d.totales;
        const explain = `
            <p>La <strong>Utilidad Bruta</strong> es lo que queda despues de descontar el costo directo de los productos vendidos (COGS).</p>
            <p>El <strong>Costo de Ventas (COGS)</strong> se calcula multiplicando la cantidad vendida de cada item × su precio de compra (lista <code>"Compra estandar"</code> en Item Price).</p>
            <p>El <strong>margen bruto %</strong> te indica que porcentaje de los ingresos queda despues de pagar los productos.</p>
        `;

        const statsHtml = `
            <div class="er-drawer-totales">
                ${renderStat('Ingresos', fmtMoney(t.revenue))}
                ${renderStat('COGS', fmtMoney(t.cogs), 'negative')}
                ${renderStat('Utilidad Bruta', fmtMoney(t.utilidad_bruta), 'positive')}
                ${renderStat('Margen Bruto %', fmtPct(t.margen_pct))}
                ${renderStat('# SKUs', t.num_items)}
            </div>`;

        let itemsHtml = '';
        if (d.items && d.items.length) {
            const rows = d.items.map(i => `
                <tr>
                    <td><strong>${i.item_name || i.item_code}</strong><br><span class="muted">${i.item_code}</span></td>
                    <td class="right">${i.qty_total.toFixed(0)}</td>
                    <td class="right">${fmtMoney(i.revenue)}</td>
                    <td class="right muted">${fmtMoney(i.unit_cost)}</td>
                    <td class="right neg">${fmtMoney(i.cogs_total)}</td>
                    <td class="right"><strong>${fmtMoney(i.margin)}</strong></td>
                    <td class="right">${fmtPct(i.margin_pct)}</td>
                </tr>
            `).join('');
            itemsHtml = `
                <div class="er-drawer-section">
                    <h3><i data-lucide="package"></i>Items vendidos (${d.items.length})</h3>
                    <div class="er-drawer-table-wrap">
                        <table class="er-drawer-table">
                            <thead><tr><th>Producto</th><th class="right">Qty</th><th class="right">Revenue</th><th class="right">Costo Unit.</th><th class="right">COGS</th><th class="right">Margen</th><th class="right">% Margen</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        }

        return renderFormula('Ingresos Netos − Costo de Ventas (COGS)') +
               `<div class="er-drawer-explain">${explain}</div>` +
               statsHtml + itemsHtml;
    }

    // ========== UTILIDAD OPERACION ==========
    function renderUtilidadOperacionDetail(d) {
        const t = d.totales;
        const explain = `
            <p>La <strong>Utilidad de Operacion</strong> es la Utilidad Bruta menos todos los <strong>gastos operativos</strong> del negocio.</p>
            <p>Los gastos se cargan desde <code>Finanzas Corporativas</code> (sin incluir caja chica) y se agrupan por <strong>categoria</strong> mediante palabras clave.</p>
            <p>Categorias que no hacen match especifico caen en <em>"Caja Chica / Otros"</em>.</p>
        `;

        const statsHtml = `
            <div class="er-drawer-totales">
                ${renderStat('Total Gastos Operacion', fmtMoney(t.total_gastos), 'negative')}
                ${renderStat('# Movimientos', t.num_movimientos)}
                ${renderStat('# Grupos', t.num_grupos)}
            </div>`;

        let gruposHtml = '';
        if (d.grupos && d.grupos.length) {
            gruposHtml = d.grupos.map(g => {
                const rows = g.items.map(i => `
                    <tr>
                        <td class="muted">${i.fecha}</td>
                        <td>${i.categoria}</td>
                        <td>${i.descripcion || '<span class="muted">—</span>'}</td>
                        <td class="muted">${i.proveedor || '—'}</td>
                        <td class="right neg"><strong>${fmtMoney(i.monto)}</strong></td>
                    </tr>
                `).join('');
                return `
                    <div class="er-drawer-subsection">
                        <div class="er-drawer-subsection-title">
                            <span class="lbl">${g.label}</span>
                            <span class="amt">${fmtMoney(g.monto)}</span>
                            <i data-lucide="chevron-down"></i>
                        </div>
                        <div class="er-drawer-subsection-body">
                            <div class="er-drawer-table-wrap">
                                <table class="er-drawer-table">
                                    <thead><tr><th>Fecha</th><th>Categoria</th><th>Descripcion</th><th>Proveedor</th><th class="right">Monto</th></tr></thead>
                                    <tbody>${rows}</tbody>
                                </table>
                            </div>
                        </div>
                    </div>`;
            }).join('');
            gruposHtml = `<div class="er-drawer-section"><h3><i data-lucide="folder-open"></i>Gastos por grupo (click para expandir)</h3>${gruposHtml}</div>`;
        }

        return renderFormula('Utilidad Bruta − Gastos de Operacion') +
               `<div class="er-drawer-explain">${explain}</div>` +
               statsHtml + gruposHtml;
    }

    // ========== UTILIDAD NETA ==========
    function renderUtilidadNetaDetail(d) {
        const r = d.resumen;
        const p = d.porcentajes;
        const explain = `
            <p>La <strong>Utilidad Neta</strong> es el resultado final del negocio despues de impuestos.</p>
            <p>Se calcula restando a la <strong>Utilidad antes de Impuestos</strong> el <strong>Impuesto a la Renta</strong> (1.5% sobre Ingresos Netos, regimen MYPE SUNAT).</p>
            <p>Aqui ves el <strong>camino completo</strong> desde Ingresos Netos hasta Utilidad Neta.</p>
        `;

        const cadenaRows = [
            ['Ingresos Netos', r.ingresos_netos, 100, 'subtotal'],
            ['(−) Costo de Ventas (COGS)', -r.costo_ventas, -p.costo_ventas, 'neg'],
            ['Utilidad Bruta', r.utilidad_bruta, p.utilidad_bruta, 'subtotal'],
            ['(−) Gastos de Operacion', -r.gastos_operacion, -p.gastos_operacion, 'neg'],
            ['Utilidad de Operacion', r.utilidad_operacion, p.utilidad_operacion, 'subtotal'],
            ['(−) Gastos Extraordinarios', -r.gastos_extraordinarios, -p.gastos_extraordinarios, 'neg'],
            ['Utilidad antes de Impuestos', r.utilidad_antes_impuestos, (r.utilidad_antes_impuestos / r.ingresos_netos * 100) || 0, 'subtotal'],
            ['(−) Impuesto a la Renta (1.5%)', -r.impuesto_renta, -p.impuesto_renta, 'neg'],
            ['Utilidad Neta', r.utilidad_neta, p.utilidad_neta, 'total'],
        ];

        const cadenaHtml = cadenaRows.map(([lbl, val, pct, cls]) => `
            <tr class="${cls}">
                <td>${cls === 'subtotal' || cls === 'total' ? '<strong>' + lbl + '</strong>' : lbl}</td>
                <td class="right ${cls === 'neg' ? 'neg' : ''}">${fmtMoney(val)}</td>
                <td class="right muted">${fmtPct(pct)}</td>
            </tr>
        `).join('');

        let extraHtml = '';
        if (d.gastos_extra_items && d.gastos_extra_items.length) {
            const rows = d.gastos_extra_items.map(e => `
                <tr>
                    <td class="muted">${e.fecha}</td>
                    <td>${e.categoria || 'Sin categoria'}</td>
                    <td>${e.descripcion || '—'}</td>
                    <td class="muted">${e.caja_chica || '—'}</td>
                    <td class="right neg"><strong>${fmtMoney(e.monto)}</strong></td>
                </tr>
            `).join('');
            extraHtml = `
                <div class="er-drawer-section">
                    <h3><i data-lucide="wallet"></i>Gastos Extraordinarios (caja chica) — ${d.gastos_extra_items.length} movimientos</h3>
                    <div class="er-drawer-table-wrap">
                        <table class="er-drawer-table">
                            <thead><tr><th>Fecha</th><th>Categoria</th><th>Descripcion</th><th>Caja</th><th class="right">Monto</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        }

        return renderFormula('Utilidad antes de Impuestos − Impuesto a la Renta (1.5%)') +
               `<div class="er-drawer-explain">${explain}</div>` +
               `<div class="er-drawer-section">
                    <h3><i data-lucide="git-branch"></i>Cadena completa de utilidades</h3>
                    <div class="er-drawer-table-wrap">
                        <table class="er-drawer-table">
                            <thead><tr><th>Concepto</th><th class="right">Monto</th><th class="right">% Ingresos Netos</th></tr></thead>
                            <tbody>${cadenaHtml}</tbody>
                        </table>
                    </div>
                </div>` +
               extraHtml;
    }

})();
