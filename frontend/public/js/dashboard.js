// dashboard.js - Dashboard charts with interactive modals and filters
// Requires Chart.js (already included in project)
// Requires Chart.js (already included in project)

/**
 * Màu sắc đẹp cho chart (dark theme)
 */
const CHART_COLORS = {
    primary: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'],
    seniority: {
        'Dưới 2 năm': '#3b82f6',
        'Từ 2 - 3.5 năm': '#22c55e',
        'Trên 3.5 năm': '#f59e0b'
    },
    pointStatus: {
        'Confirmed': '#22c55e',
        'Unconfirmed': '#f59e0b'
    }
};

/**
 * Parse date from Vietnamese format or common formats
 */
function parseDate(dateStr) {
    if (!dateStr || dateStr === '-' || dateStr === '') return null;

    // Try DD/MM/YYYY or DD-MM-YYYY
    const match1 = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match1) {
        return new Date(parseInt(match1[3]), parseInt(match1[2]) - 1, parseInt(match1[1]));
    }

    // Try YYYY-MM-DD
    const match2 = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (match2) {
        return new Date(parseInt(match2[1]), parseInt(match2[2]) - 1, parseInt(match2[3]));
    }

    // Try MM-YYYY or Tháng MM/YYYY
    const match3 = dateStr.match(/(\d{1,2})[\/\-](\d{4})/);
    if (match3) {
        return new Date(parseInt(match3[2]), parseInt(match3[1]) - 1, 1);
    }

    return null;
}

/**
 * Get month/year from date
 */
function getMonthYear(date) {
    if (!date) return null;
    return { month: date.getMonth() + 1, year: date.getFullYear() };
}

/**
 * Get unique months/years from data
 */
function extractMonthsYears(data, dateColName) {
    const months = new Set();
    const years = new Set();

    data.forEach(row => {
        const dateVal = row[dateColName];
        const parsed = parseDate(dateVal);
        if (parsed) {
            months.add(parsed.getMonth() + 1);
            years.add(parsed.getFullYear());
        }
    });

    return {
        months: Array.from(months).sort((a, b) => a - b),
        years: Array.from(years).sort((a, b) => b - a) // Newest first
    };
}

/**
 * Filter data by month/year
 */
function filterByMonthYear(data, dateColName, month, year) {
    if (!month && !year) return data;

    return data.filter(row => {
        const dateVal = row[dateColName];
        const parsed = parseDate(dateVal);
        if (!parsed) return false;

        if (month && parsed.getMonth() + 1 !== month) return false;
        if (year && parsed.getFullYear() !== year) return false;
        return true;
    });
}

/**
 * Get unique values from column
 */
function getUniqueValues(data, colName) {
    if (!colName) return [];
    return [...new Set(data.map(r => r[colName]).filter(v => v && v !== '-' && v !== ''))].sort();
}

/**
 * Create modal element for detail view
 */
function createModal() {
    if (document.getElementById('dashboard-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'dashboard-modal';
    modal.innerHTML = `
        <style>
            #dashboard-modal {
                display: none;
                position: fixed;
                top: 0; left: 0;
                width: 100%; height: 100%;
                background: rgba(0,0,0,0.7);
                z-index: 10000;
                justify-content: center;
                align-items: center;
            }
            #dashboard-modal.show { display: flex; }
            .modal-content {
                background: #1e293b;
                border: 1px solid #475569;
                border-radius: 12px;
                max-width: 800px;
                max-height: 80vh;
                width: 90%;
                overflow: hidden;
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            }
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                background: #0f172a;
                border-bottom: 1px solid #334155;
            }
            .modal-header h3 { margin: 0; color: #e2e8f0; font-size: 1.1rem; }
            .modal-close {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 1.5rem;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            }
            .modal-close:hover { color: #ef4444; }
            .modal-body {
                padding: 20px;
                max-height: calc(80vh - 60px);
                overflow-y: auto;
            }
            .modal-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.85rem;
            }
            .modal-table th {
                background: #0f172a;
                color: #94a3b8;
                padding: 10px;
                text-align: left;
                border-bottom: 1px solid #334155;
                position: sticky;
                top: 0;
            }
            .modal-table td {
                padding: 10px;
                color: #e2e8f0;
                border-bottom: 1px solid #334155;
            }
            .modal-table tr:hover td { background: #263548; }
            .dash-filter-bar {
                display: flex;
                gap: 12px;
                align-items: center;
                margin-bottom: 16px;
                flex-wrap: wrap;
            }
            .dash-filter-bar select, .dash-filter-bar input {
                padding: 6px 12px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                color: #e2e8f0;
                font-size: 0.85rem;
                cursor: pointer;
            }
            .dash-filter-bar select:hover, .dash-filter-bar input:hover { border-color: #3b82f6; }
            .dash-filter-bar label {
                color: #94a3b8;
                font-size: 0.85rem;
            }
            .dash-filter-btn {
                padding: 6px 16px;
                background: #3b82f6;
                border: none;
                border-radius: 6px;
                color: white;
                font-size: 0.85rem;
                cursor: pointer;
                font-weight: 500;
            }
            .dash-filter-btn:hover { background: #2563eb; }
        </style>
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="modal-title">Chi tiết</h3>
                <button class="modal-close" id="modal-close-btn">&times;</button>
            </div>
            <div class="modal-body" id="modal-body"></div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
    });
    
    // Close modal when clicking X button
    document.getElementById('modal-close-btn').addEventListener('click', () => {
        modal.classList.remove('show');
    });

    // Close modal when pressing ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) {
            modal.classList.remove('show');
        }
    });
}

/**
 * Show modal with data
 */
function showDetailModal(title, data, columns) {
    createModal();
    const modal = document.getElementById('dashboard-modal');
    document.getElementById('modal-title').textContent = title;

    const body = document.getElementById('modal-body');

    if (!data || data.length === 0) {
        body.innerHTML = '<p style="color:#94a3b8;text-align:center;">Không có dữ liệu</p>';
    } else {
        const cols = columns || Object.keys(data[0]).slice(0, 6);
        body.innerHTML = `
            <table class="modal-table">
                <thead>
                    <tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${data.slice(0, 50).map(row => `
                        <tr>${cols.map(c => `<td>${row[c] || '-'}</td>`).join('')}</tr>
                    `).join('')}
                </tbody>
            </table>
            ${data.length > 50 ? `<p style="color:#94a3b8;text-align:center;margin-top:12px;">...và ${data.length - 50} mục khác</p>` : ''}
        `;
    }

    modal.classList.add('show');
}

/**
 * Create a chart card wrapper
 */
function createChartCard(id, title, width = '48%') {
    return `
        <div class="dash-card" style="width:${width};min-width:280px;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;box-sizing:border-box;">
            <h4 style="margin:0 0 12px 0;color:#e2e8f0;font-size:0.9rem;">${title}</h4>
            <div style="position:relative;height:200px;">
                <canvas id="${id}"></canvas>
            </div>
        </div>
    `;
}

const chartInstances = {};

function destroyChart(id) {
    if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
    }
}

/**
 * Render RAW DATA DASHBOARD with comprehensive filters
 */
export function renderRawDataDashboard(data, container, databaseName, options = {}) {
    if (!data || data.length === 0) return;

    const { sprintFilter = '', assigneeFilter = '', selectedMonth = '', selectedYear = '' } = options;

    // Detect available columns
    const sampleRow = data[0];
    const columns = Object.keys(sampleRow);

    // Find column names - exact match first, then partial
    const findCol = (...names) => {
        let found = columns.find(c => names.some(n => c.toLowerCase() === n.toLowerCase()));
        if (found) return found;
        return columns.find(c => names.some(n => c.toLowerCase().includes(n.toLowerCase())));
    };

    const assigneeCol = findCol('ASSIGNEE', 'Người thực hiện', 'Assignee', 'Người làm', 'OWNER', 'Owner');
    const productCol = findCol('PRODUCT TYPE', 'Product Type', 'Loại sản phẩm');
    const sprintCol = findCol('Sprint', 'SPRINT');
    const pointStatusCol = findCol('POINT STATUS', 'Point Status', 'Trạng thái điểm');
    const sceneTypeCol = findCol('LOẠI CẢNH', 'Loại cảnh', 'Scene Type', 'Scene');
    const taskTypeCol = findCol('TASK TYPE', 'Task Type', 'Loại task');
    const dateCol = findCol('DoneDate', 'Done Date', 'DONE DATE', 'NGÀY LÀM', 'Ngày làm', 'Date', 'Created', 'Updated');

    // Get filter options
    const sprints = getUniqueValues(data, sprintCol);
    const assignees = getUniqueValues(data, assigneeCol);
    const { months, years } = dateCol ? extractMonthsYears(data, dateCol) : { months: [], years: [] };

    // Apply filters
    let filteredData = [...data];
    if (sprintFilter && sprintCol) {
        filteredData = filteredData.filter(r => r[sprintCol] === sprintFilter);
    }
    if (assigneeFilter && assigneeCol) {
        filteredData = filteredData.filter(r => r[assigneeCol] === assigneeFilter);
    }
    if (dateCol && (selectedMonth || selectedYear)) {
        filteredData = filterByMonthYear(filteredData, dateCol,
            selectedMonth ? parseInt(selectedMonth) : null,
            selectedYear ? parseInt(selectedYear) : null);
    }

    // Build charts list
    const charts = [];
    if (assigneeCol) charts.push({ id: 'chart-raw-assignee', title: '👤 Theo Assignee', col: assigneeCol, type: 'bar' });
    if (productCol) charts.push({ id: 'chart-raw-product', title: '📦 Theo Product Type', col: productCol, type: 'doughnut' });
    if (sprintCol && sprints.length > 0) charts.push({ id: 'chart-raw-sprint', title: '🏃 Theo Sprint', col: sprintCol, type: 'bar' });
    if (pointStatusCol) charts.push({ id: 'chart-raw-pointstatus', title: '✅ Theo Point Status', col: pointStatusCol, type: 'pie' });
    if (sceneTypeCol) charts.push({ id: 'chart-raw-scenetype', title: '🎬 Theo Loại cảnh', col: sceneTypeCol, type: 'doughnut' });
    if (taskTypeCol) charts.push({ id: 'chart-raw-tasktype', title: '📋 Theo Task Type', col: taskTypeCol, type: 'bar' });

    if (charts.length === 0) {
        console.log('[Dashboard] No chartable columns found in raw data');
        return;
    }

    // Remove existing dashboard
    const existing = container.querySelector('.raw-dashboard');
    if (existing) existing.remove();

    // Current month/year for defaults
    const now = new Date();
    const currentMonth = selectedMonth || '';
    const currentYear = selectedYear || (years.length > 0 ? years[0] : now.getFullYear());

    // Create dashboard container with filter bar
    const dashDiv = document.createElement('div');
    dashDiv.className = 'raw-dashboard';
    dashDiv.style.cssText = 'margin-bottom:20px;padding:16px;background:#0f172a;border-radius:12px;border:1px solid #334155;';
    dashDiv.innerHTML = `
        <div class="dash-filter-bar">
            <h3 style="margin:0;color:#e2e8f0;font-size:1rem;">📊 Dashboard: ${databaseName || 'Raw Data'}</h3>
        </div>
        <div class="dash-filter-bar" style="margin-bottom:12px;">
            <label>Chọn Thời gian:</label>
            <select id="raw-month-filter" style="min-width:100px;">
                <option value="">Tất cả tháng</option>
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => `<option value="${m}" ${currentMonth == m ? 'selected' : ''}>Tháng ${m}</option>`).join('')}
            </select>
            <select id="raw-year-filter" style="min-width:80px;">
                ${years.map(y => `<option value="${y}" ${currentYear == y ? 'selected' : ''}>${y}</option>`).join('')}
                ${years.length === 0 ? `<option value="${now.getFullYear()}">${now.getFullYear()}</option>` : ''}
            </select>
            
            ${assigneeCol ? `
                <label style="margin-left:16px;">Nhân sự:</label>
                <select id="raw-assignee-filter" style="min-width:150px;">
                    <option value="">Tất cả</option>
                    ${assignees.map(a => `<option value="${a}" ${assigneeFilter === a ? 'selected' : ''}>${a}</option>`).join('')}
                </select>
            ` : ''}
            
            ${sprintCol && sprints.length > 0 ? `
                <label style="margin-left:16px;">Sprint:</label>
                <select id="raw-sprint-filter" style="min-width:120px;">
                    <option value="">Tất cả Sprint</option>
                    ${sprints.map(s => `<option value="${s}" ${sprintFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            ` : ''}
            
            <button id="raw-apply-filter" class="dash-filter-btn">🔄 Cập nhật</button>
        </div>
        <p style="margin:0 0 12px 0;color:#64748b;font-size:0.8rem;">
            📊 ${filteredData.length} / ${data.length} task
            ${selectedMonth ? ` | Tháng ${selectedMonth}` : ''}
            ${selectedYear ? `/${selectedYear}` : ''}
            ${sprintFilter ? ` | ${sprintFilter}` : ''}
            ${assigneeFilter ? ` | ${assigneeFilter}` : ''}
        </p>
        <div id="raw-charts-container" style="display:flex;flex-wrap:wrap;gap:16px;">
            ${charts.map(c => createChartCard(c.id, c.title, charts.length <= 3 ? '32%' : '48%')).join('')}
        </div>
    `;
    container.insertBefore(dashDiv, container.firstChild);

    // Attach filter events
    document.getElementById('raw-apply-filter')?.addEventListener('click', () => {
        const newMonth = document.getElementById('raw-month-filter')?.value || '';
        const newYear = document.getElementById('raw-year-filter')?.value || '';
        const newAssignee = document.getElementById('raw-assignee-filter')?.value || '';
        const newSprint = document.getElementById('raw-sprint-filter')?.value || '';
        
        // Dispatch event to sync with table
        document.dispatchEvent(new CustomEvent('dashboard-filter-change', {
            detail: {
                selectedMonth: newMonth,
                selectedYear: newYear,
                assigneeFilter: newAssignee,
                sprintFilter: newSprint
            }
        }));
        
        renderRawDataDashboard(data, container, databaseName, {
            selectedMonth: newMonth,
            selectedYear: newYear,
            assigneeFilter: newAssignee,
            sprintFilter: newSprint
        });
    });

    // Render each chart
    charts.forEach((chartConfig, idx) => {
        setTimeout(() => {
            renderGroupedChart(chartConfig.id, filteredData, chartConfig.col, chartConfig.type);
        }, 100 + idx * 50);
    });
}

/**
 * Render PRODUCTIVITY DASHBOARD with time filters
 */
export function renderProductivityDashboard(data, container, options = {}) {
    if (!data || data.length === 0) return;

    // Create dashboard container
    const existing = container.querySelector('.prod-dashboard');
    if (existing) existing.remove();

    const dashDiv = document.createElement('div');
    dashDiv.className = 'prod-dashboard';
    dashDiv.style.cssText = 'margin-bottom:20px;padding:16px;background:#0f172a;border-radius:12px;border:1px solid #334155;';
    dashDiv.innerHTML = `
        <div class="dash-filter-bar">
            <h3 style="margin:0;color:#e2e8f0;font-size:1rem;flex:1;">📊 Dashboard Năng suất</h3>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:16px;">
            ${createChartCard('chart-seniority-count', '👥 Nhân sự theo Thâm niên', '32%')}
            ${createChartCard('chart-seniority-productivity', '📈 Năng suất TB theo Thâm niên', '32%')}
            ${createChartCard('chart-seniority-completion', '✅ Hoàn thành Point theo Thâm niên', '32%')}
        </div>
    `;
    container.insertBefore(dashDiv, container.firstChild);

    // Group data by seniority
    const seniorityGroups = {};
    data.forEach(row => {
        const sen = row.seniority || 'Chưa xác định';
        if (!seniorityGroups[sen]) {
            seniorityGroups[sen] = { count: 0, productivityTotal: 0, completionTotal: 0, items: [] };
        }
        seniorityGroups[sen].count++;
        seniorityGroups[sen].productivityTotal += parseFloat(row.productivityTotal) || 0;
        seniorityGroups[sen].completionTotal += parseFloat(row.completionPointTotal) || 0;
        seniorityGroups[sen].items.push(row);
    });

    const labels = Object.keys(seniorityGroups);
    const colors = labels.map(l => CHART_COLORS.seniority[l] || '#64748b');

    // Chart 1: Count by Seniority
    setTimeout(() => {
        destroyChart('chart-seniority-count');
        const ctx1 = document.getElementById('chart-seniority-count');
        if (!ctx1) return;

        chartInstances['chart-seniority-count'] = new Chart(ctx1, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: labels.map(l => seniorityGroups[l].count),
                    backgroundColor: colors,
                    borderColor: '#1e293b',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const label = labels[idx];
                        showDetailModal(`Nhân sự: ${label}`, seniorityGroups[label].items, ['fullName', 'seniority', 'taskCount', 'pointTotal']);
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw} người` }
                    }
                }
            }
        });
    }, 100);

    // Chart 2: Avg Productivity by Seniority
    setTimeout(() => {
        destroyChart('chart-seniority-productivity');
        const ctx2 = document.getElementById('chart-seniority-productivity');
        if (!ctx2) return;

        chartInstances['chart-seniority-productivity'] = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Năng suất TB',
                    data: labels.map(l => {
                        const g = seniorityGroups[l];
                        return g.count > 0 ? (g.productivityTotal / g.count).toFixed(2) : 0;
                    }),
                    backgroundColor: colors,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const label = labels[idx];
                        showDetailModal(`Năng suất: ${label}`, seniorityGroups[label].items, ['fullName', 'productivityTotal', 'pointTotal', 'effortTotal']);
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        callbacks: { label: (ctx) => `Năng suất: ${ctx.raw}` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, beginAtZero: true }
                }
            }
        });
    }, 150);

    // Chart 3: Completion Rate by Seniority
    setTimeout(() => {
        destroyChart('chart-seniority-completion');
        const ctx3 = document.getElementById('chart-seniority-completion');
        if (!ctx3) return;

        chartInstances['chart-seniority-completion'] = new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Tỷ lệ hoàn thành',
                    data: labels.map(l => {
                        const g = seniorityGroups[l];
                        return g.count > 0 ? ((g.completionTotal / g.count) * 100).toFixed(1) : 0;
                    }),
                    backgroundColor: colors,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const label = labels[idx];
                        showDetailModal(`Hoàn thành Point: ${label}`, seniorityGroups[label].items, ['fullName', 'completionPointTotal', 'pointReq', 'pointTotal']);
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        callbacks: { label: (ctx) => `Hoàn thành: ${ctx.raw}%` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: '#334155' }, beginAtZero: true, max: 150 },
                    y: { ticks: { color: '#94a3b8' }, grid: { display: false } }
                }
            }
        });
    }, 200);
}

/**
 * Render a grouped chart
 */
function renderGroupedChart(canvasId, data, columnName, chartType) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const groups = {};
    data.forEach(row => {
        const val = row[columnName] || 'Không xác định';
        if (!groups[val]) groups[val] = { count: 0, items: [] };
        groups[val].count++;
        groups[val].items.push(row);
    });

    let labels = Object.keys(groups).sort((a, b) => groups[b].count - groups[a].count);
    if (labels.length > 10) {
        const others = labels.slice(10);
        const othersCount = others.reduce((sum, l) => sum + groups[l].count, 0);
        const othersItems = others.flatMap(l => groups[l].items);
        labels = labels.slice(0, 10);
        labels.push('Khác');
        groups['Khác'] = { count: othersCount, items: othersItems };
    }

    const colors = labels.map((_, i) => CHART_COLORS.primary[i % CHART_COLORS.primary.length]);

    chartInstances[canvasId] = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: [{
                data: labels.map(l => groups[l].count),
                backgroundColor: colors,
                borderColor: chartType === 'bar' ? colors : '#1e293b',
                borderWidth: chartType === 'bar' ? 0 : 2,
                borderRadius: chartType === 'bar' ? 4 : 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const label = labels[idx];
                    const displayCols = Object.keys(data[0]).slice(0, 5);
                    showDetailModal(`${columnName}: ${label}`, groups[label].items, displayCols);
                }
            },
            plugins: {
                legend: {
                    display: chartType !== 'bar',
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw} task` }
                }
            },
            scales: chartType === 'bar' ? {
                x: { ticks: { color: '#94a3b8', maxRotation: 45 }, grid: { display: false } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, beginAtZero: true }
            } : undefined
        }
    });
}

// Export for use
window.renderProductivityDashboard = renderProductivityDashboard;
window.renderRawDataDashboard = renderRawDataDashboard;
window.showDetailModal = showDetailModal;
