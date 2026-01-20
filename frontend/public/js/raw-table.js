// raw-table.js - Enhanced with Search, Filter, Sort
/**
 * Render raw data table with search, filter, and sort capabilities
 */
export function renderRawDataTable(data, container) {
    if (!data || !data.success) {
        container.innerHTML = `
            <div class="error-message">
                <p>❌ ${data?.error || 'Failed to load data'}</p>
            </div>
        `;
        return;
    }

    const { database_name, columns, data: rows, total_records } = data;

    // State
    let filteredRows = [...rows];
    let sortColumn = null;
    let sortDirection = 'asc';

    // Create UI
    const wrapper = document.createElement('div');
    wrapper.className = 'raw-data-view';
    wrapper.innerHTML = `
        <div class="raw-data-header">
            <h3>📊 ${database_name}</h3>
            <p class="data-info">${total_records} records • ${columns.length} columns</p>
        </div>
        
        <div class="raw-data-controls">
            <input type="text" id="raw-search" placeholder="🔍 Tìm kiếm..." 
                style="flex: 1; padding: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white;">
            
            <select id="filter-column" style="padding: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white;">
                <option value="">Tất cả columns</option>
                ${columns.map(col => `<option value="${col}">${col}</option>`).join('')}
            </select>
        </div>
        
        <div class="table-container">
            <table id="raw-table">
                <thead>
                    <tr>
                        ${columns.map(col => `
                            <th data-column="${col}" style="cursor: pointer; user-select: none;">
                                ${col} <span class="sort-indicator">↕</span>
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody id="raw-tbody">
                </tbody>
            </table>
        </div>
        
        <div class="raw-data-footer" style="margin-top: 1rem; display: flex; justify-content: space-between; align-items: center;">
            <span id="row-count" style="font-size: 0.875rem; color: rgba(255,255,255,0.7);"></span>
            <button id="export-csv" style="padding: 0.5rem 1rem; background: rgba(99,102,241,0.8); color: white; border: none; border-radius: 4px; cursor: pointer;">
                📥 Export CSV
            </button>
        </div>
    `;

    container.innerHTML = '';
    container.appendChild(wrapper);

    // Render table
    const renderTable = () => {
        const tbody = document.getElementById('raw-tbody');
        tbody.innerHTML = filteredRows.map(row => `
            <tr>
                ${columns.map(col => `<td>${escapeHtml(row[col] || '')}</td>`).join('')}
            </tr>
        `).join('');

        document.getElementById('row-count').textContent =
            `Hiển thị ${filteredRows.length} / ${total_records} dòng`;
    };

    // Search
    document.getElementById('raw-search').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filterCol = document.getElementById('filter-column').value;

        filteredRows = rows.filter(row => {
            if (filterCol) {
                // Search in specific column
                const value = String(row[filterCol] || '').toLowerCase();
                return value.includes(query);
            } else {
                // Search in all columns
                return columns.some(col => {
                    const value = String(row[col] || '').toLowerCase();
                    return value.includes(query);
                });
            }
        });

        renderTable();
    });

    // Filter column change
    document.getElementById('filter-column').addEventListener('change', () => {
        // Trigger search again
        document.getElementById('raw-search').dispatchEvent(new Event('input'));
    });

    // Sort
    document.querySelectorAll('#raw-table th').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.column;

            if (sortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = column;
                sortDirection = 'asc';
            }

            // Sort
            filteredRows.sort((a, b) => {
                let aVal = a[column] || '';
                let bVal = b[column] || '';

                // Try to parse as number
                const aNum = parseFloat(aVal);
                const bNum = parseFloat(bVal);

                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
                }

                // String comparison
                aVal = String(aVal).toLowerCase();
                bVal = String(bVal).toLowerCase();

                if (sortDirection === 'asc') {
                    return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                } else {
                    return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
                }
            });

            // Update indicators
            document.querySelectorAll('.sort-indicator').forEach(ind => {
                ind.textContent = '↕';
            });
            th.querySelector('.sort-indicator').textContent = sortDirection === 'asc' ? '↑' : '↓';

            renderTable();
        });
    });

    // Export CSV
    document.getElementById('export-csv').addEventListener('click', () => {
        const csv = [
            columns.join(','),
            ...filteredRows.map(row =>
                columns.map(col => {
                    const val = row[col] || '';
                    return `"${String(val).replace(/"/g, '""')}"`;
                }).join(',')
            )
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${database_name.replace(/[^a-z0-9]/gi, '_')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });

    renderTable();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.renderRawDataTable = renderRawDataTable;
