(function () {
    const fmtS = (v) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(v || 0);
    let debounceTimer = null;

    // Inicializar rango de fechas al mes actual
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    const desdeEl = document.getElementById('pv-filter-desde');
    const hastaEl = document.getElementById('pv-filter-hasta');
    desdeEl.value = `${y}-${m}-01`;
    hastaEl.value = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    desdeEl.onchange = () => pvFetch();
    hastaEl.onchange = () => pvFetch();

    frappe.ready(() => {
        pvFetch();
        if (window.lucide) lucide.createIcons();
    });

    function pvFetch() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const fecha_desde = desdeEl.value || '';
            const fecha_hasta = hastaEl.value || '';
            const q = document.getElementById('pv-filter-q').value;
            const canal = document.getElementById('pv-filter-canal').value;

            document.getElementById('pv-loader').style.display = 'flex';

            frappe.call({
                method: 'finhub.www.prorrateo_ventas.index.get_prorrateo_ventas',
                args: { fecha_desde, fecha_hasta, q, canal },
                callback: function (r) {
                    document.getElementById('pv-loader').style.display = 'none';
                    if (r.message) {
                        renderAll(r.message);
                    }
                    if (window.lucide) lucide.createIcons();
                }
            });
        }, 400);
    }

    function renderAll(msg) {
        const { data, resumen, totales } = msg;
        const commissionBar = document.getElementById('commission-breakdown-bar');
        const commissionCont = document.getElementById('commission-tags-container');

        // Formula bar
        const formulaBar = document.getElementById('pv-formula-bar');
        const formulaText = document.getElementById('pv-formula-text');
        if (resumen.facturas_count > 0) {
            formulaBar.style.display = 'flex';
            formulaText.innerHTML = `Prorrateo Base = (<strong>${fmtS(resumen.gastos_fijos)}</strong> Gastos Fijos + <strong>${fmtS(resumen.caja_chica)}</strong> Caja Chica) / <strong>${resumen.facturas_count}</strong> facturas = <strong>${fmtS(resumen.prorrateo_base)}</strong> por factura`;
        } else {
            formulaBar.style.display = 'none';
        }

        // Summary
        document.getElementById('pv-sum-count').textContent = totales.count;
        document.getElementById('pv-sum-ingreso').textContent = fmtS(totales.ingreso);
        document.getElementById('pv-sum-costo').textContent = fmtS(totales.costo_venta);
        document.getElementById('pv-sum-prorrateo').textContent = fmtS(totales.prorrateado);
        document.getElementById('pv-sum-envio').textContent = fmtS(totales.envio);
        document.getElementById('pv-sum-comision').textContent = fmtS(totales.comision_venta + totales.comision);

        const commissionEntries = Object.entries(totales.commissions_by_mode || {}).filter(([_, amount]) => amount > 0);
        if (commissionBar && commissionCont) {
            commissionBar.style.display = commissionEntries.length > 0 ? 'block' : 'none';
            commissionCont.innerHTML = commissionEntries.map(([mode, amount]) => `
                <div style="display:flex; flex-direction:column; padding:12px 16px; background:var(--gray-50); border:1px solid var(--border); border-radius:var(--radius); min-width:140px; box-shadow:var(--shadow-sm);">
                    <span style="font-size:.65rem; color:var(--text-tertiary); font-weight:700; text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">${mode}</span>
                    <span style="font-size:1.1rem; font-weight:800; color:var(--brand); font-family:var(--font-display);">${fmtS(amount)}</span>
                </div>
            `).join('');
        }

        const margenEl = document.getElementById('pv-sum-margen');
        margenEl.textContent = fmtS(totales.margen_neto);
        margenEl.style.color = totales.margen_neto >= 0 ? 'var(--positive)' : 'var(--negative)';

        // Table
        const tbody = document.getElementById('pv-tbody');
        const empty = document.getElementById('pv-empty');

        if (!data || data.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';

        tbody.innerHTML = data.map(row => {
            const canalBadge = getCanalBadge(row.canal);
            const margenNeto = (flt(row.ingreso) || 0)
                - (flt(row.costo_venta) || 0)
                - (flt(row.embalaje) || 0)
                - (flt(row.prorrateado) || 0)
                - (flt(row.envio) || 0)
                - (flt(row.comision_venta) || 0)
                - (flt(row.comision) || 0);
            return `<tr>
                <td class="pv-mono" style="font-weight:600;">
                    ${row.orden_venta
                        ? `<a href="/app/sales-order/${row.orden_venta}" target="_blank" style="color:var(--brand);text-decoration:none;">${row.orden_venta}</a>`
                        : '<span style="color:var(--text-tertiary);">-</span>'
                    }
                </td>
                <td class="pv-mono" style="font-weight:600;">
                    <a href="/app/sales-invoice/${row.factura}" target="_blank" style="color:var(--text-secondary);text-decoration:none;">${row.factura}</a>
                </td>
                <td>${canalBadge}</td>
                <td class="right pv-mono" style="font-weight:600;">${fmtS(row.ingreso)}</td>
                <td class="right pv-mono pv-val-negative">${fmtS(row.costo_venta)}</td>
                <td class="right pv-mono" style="color:var(--text-secondary);">${fmtS(row.embalaje)}</td>
                <td class="right pv-mono" style="color:var(--violet-600);font-weight:600;">${fmtS(row.prorrateado)}</td>
                <td class="right pv-mono" style="color:var(--amber-600);">${fmtS(row.envio)}</td>
                <td class="right pv-mono pv-val-negative">${fmtS(row.comision_venta)}</td>
                <td class="right pv-mono pv-val-negative">${fmtS(row.comision)}</td>
                <td class="right pv-mono" style="font-weight:700;color:${margenNeto >= 0 ? 'var(--positive)' : 'var(--negative)'};">${fmtS(margenNeto)} <span style="font-size:.7rem;opacity:.7;">(${((margenNeto / (flt(row.ingreso) || 1)) * 100).toFixed(1)}%)</span></td>
            </tr>`;
        }).join('');

        // Fila de totales
        tbody.innerHTML += `<tr class="row-total">
            <td colspan="3" style="text-align:right; font-family:var(--font-mono); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:var(--text-tertiary);">TOTALES</td>
            <td class="right pv-mono" style="font-weight:800;">${fmtS(totales.ingreso)}</td>
            <td class="right pv-mono pv-val-negative" style="font-weight:800;">${fmtS(totales.costo_venta)}</td>
            <td class="right pv-mono" style="font-weight:800;">${fmtS(totales.embalaje)}</td>
            <td class="right pv-mono" style="color:var(--violet-600);font-weight:800;">${fmtS(totales.prorrateado)}</td>
            <td class="right pv-mono" style="color:var(--amber-600);font-weight:800;">${fmtS(totales.envio)}</td>
            <td class="right pv-mono pv-val-negative" style="font-weight:800;">${fmtS(totales.comision_venta)}</td>
            <td class="right pv-mono pv-val-negative" style="font-weight:800;">${fmtS(totales.comision)}</td>
            <td class="right pv-mono" style="font-weight:800;color:${(totales.ingreso - totales.costo_venta - totales.embalaje - totales.prorrateado - totales.envio - totales.comision_venta - totales.comision) >= 0 ? 'var(--positive)' : 'var(--negative)'};">${fmtS(totales.ingreso - totales.costo_venta - totales.embalaje - totales.prorrateado - totales.envio - totales.comision_venta - totales.comision)} <span style="font-size:.7rem;opacity:.7;">(${(((totales.ingreso - totales.costo_venta - totales.embalaje - totales.prorrateado - totales.envio - totales.comision_venta - totales.comision) / (totales.ingreso || 1)) * 100).toFixed(1)}%)</span></td>
        </tr>`;
    }

    function getCanalBadge(canal) {
        const c = (canal || '').toLowerCase();
        if (c.includes('shopify')) return `<span class="pv-badge pv-badge-blue">${canal}</span>`;
        if (c.includes('whatsapp') || c.includes('wsp')) return `<span class="pv-badge pv-badge-violet">${canal}</span>`;
        if (c.includes('tienda') || c.includes('fisica') || c.includes('física')) return `<span class="pv-badge pv-badge-amber">${canal}</span>`;
        return `<span class="pv-badge pv-badge-gray">${canal}</span>`;
    }

    function pvExport() {
        const table = document.querySelector('.pv-table');
        if (!table) return;

        let csv = '';
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('th, td');
            const rowData = [];
            cells.forEach(cell => {
                let text = cell.innerText.replace(/"/g, '""').trim();
                rowData.push(`"${text}"`);
            });
            csv += rowData.join(',') + '\n';
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `prorrateo_ventas_${desdeEl.value}_a_${hastaEl.value}.csv`;
        link.click();
    }

    // Exponer globalmente
    window.pvFetch = pvFetch;
    window.pvExport = pvExport;
})();
