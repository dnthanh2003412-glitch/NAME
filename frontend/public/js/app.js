// app.js - Final Dash Notion V3 (Refined)

const API_BASE = window.location.origin;

class DashboardApp {
    constructor() {
        this.projectsHierarchy = [];
        this.databaseNames = new Map();

        // Persistence: Load selected databases
        this.selectedDatabases = new Set();
        this.selectedProjects = new Set();
        this.hiddenProjects = new Set();
        this.hiddenDatabases = new Set();

        this.loadPersistedState();

        this.searchQuery = '';
        this.isHiddenGroupOpen = true;
        this.databaseCounts = {}; // Store record counts
        this.initialFetchDone = false;
    }

    async init() {
        console.log('[Dashboard] Initializing...');
        this.setupEventListeners();

        // Initial Load
        await this.loadProjectsTree();

        // Start Polling
        this.startPolling();
    }

    loadPersistedState() {
        try {
            // Load selected databases
            const savedSelected = localStorage.getItem('dashNotion_selectedDatabases');
            if (savedSelected) {
                const ids = JSON.parse(savedSelected);
                if (Array.isArray(ids)) ids.forEach(id => this.selectedDatabases.add(id));
            }

            // Load hidden items
            const savedHiddenProj = localStorage.getItem('dashNotion_hiddenProjects');
            if (savedHiddenProj) {
                const names = JSON.parse(savedHiddenProj);
                if (Array.isArray(names)) names.forEach(n => this.hiddenProjects.add(n));
            }

            const savedHiddenDb = localStorage.getItem('dashNotion_hiddenDatabases');
            if (savedHiddenDb) {
                const ids = JSON.parse(savedHiddenDb);
                if (Array.isArray(ids)) ids.forEach(id => this.hiddenDatabases.add(id));
            }

        } catch (e) {
            console.error('Error loading state:', e);
        }
    }

    savePersistedState() {
        localStorage.setItem('dashNotion_selectedDatabases', JSON.stringify([...this.selectedDatabases]));
        localStorage.setItem('dashNotion_hiddenProjects', JSON.stringify([...this.hiddenProjects]));
        localStorage.setItem('dashNotion_hiddenDatabases', JSON.stringify([...this.hiddenDatabases]));
    }

    setupEventListeners() {
        // Search
        const searchInput = document.getElementById('sidebar-search') || document.getElementById('project-search'); // Fallback
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.trim();
                this.renderProjectsTreeHierarchical();
            });
        }

        // Report Controls
        const generateBtn = document.getElementById('generate-report-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generateReport());
        }

        const reportTypeSelect = document.getElementById('report-type-select');
        if (reportTypeSelect) {
            reportTypeSelect.addEventListener('change', () => this.updateGenerateButtonState());
        }

        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                // Show loading state
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" class="spin">
                    <path d="M21 12a9 9 0 11-2.636-6.364M21 3v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`;
                refreshBtn.style.animation = 'spin 1s linear infinite';

                try {
                    // First, sync selected databases to backend config
                    const dbIds = Array.from(this.selectedDatabases);
                    if (dbIds.length > 0) {
                        await fetch(`${API_BASE}/api/databases/select`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ database_ids: dbIds })
                        });
                        console.log(`[Refresh] Synced ${dbIds.length} databases to backend`);
                    }

                    // Then call refresh API to fetch latest data from Notion
                    const response = await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
                    const result = await response.json();

                    if (result.success) {
                        // Refresh the UI
                        await this.loadProjectsTree();
                        if (this.selectedDatabases.size > 0) {
                            await this.fetchSelectedDatabases(false);
                        }
                        // Also regenerate report if one is active
                        const reportType = document.getElementById('report-type-select')?.value;
                        if (reportType) {
                            this.generateReport();
                        }
                        console.log('✅ Data refreshed from Notion');
                    } else {
                        console.error('Refresh failed:', result.error);
                    }
                } catch (err) {
                    console.error('Refresh error:', err);
                } finally {
                    // Restore button
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M21 12a9 9 0 11-2.636-6.364M21 3v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>`;
                    refreshBtn.style.animation = '';
                }
            });
        }
    }

    updateGenerateButtonState() {
        const generateBtn = document.getElementById('generate-report-btn');
        const reportType = document.getElementById('report-type-select')?.value;
        const hasSelection = this.selectedDatabases.size > 0;

        if (generateBtn) {
            generateBtn.disabled = !(hasSelection && reportType);
            // Update Selected Count Text
            const countSpan = document.getElementById('selected-count');
            if (countSpan) {
                countSpan.textContent = hasSelection ? `Đã chọn ${this.selectedDatabases.size} database` : 'Chưa chọn dự án';
            }
        }
    }

    generateReport() {
        const reportType = document.getElementById('report-type-select')?.value;
        if (!reportType) return;

        const container = document.getElementById('report-container');
        if (!container) return;

        // Clear Welcome Screen
        container.innerHTML = '';

        switch (reportType) {
            case 'raw':
                this.renderRawDataReport(container);
                break;
            case 'sprint':
                this.renderSprintReport(container); // Placeholder
                break;
            case 'productivity':
                this.renderProductivityReport(container); // Placeholder
                break;
            default:
                container.innerHTML = '<div class="error-state">Loại báo cáo chưa được hỗ trợ</div>';
        }
    }

    async renderRawDataReport(container) {
        // Show loading state
        container.innerHTML = '<div class="loading-state" style="padding:40px;text-align:center;color:#64748b;">Đang tải dữ liệu thô...</div>';

        const dbIds = Array.from(this.selectedDatabases);
        if (dbIds.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Chưa chọn database nào.</div>';
            return;
        }

        try {
            // Fetch raw data for each database
            for (const dbId of dbIds) {
                // Use the raw API endpoint which returns flattened data with all Notion columns
                const url = `${API_BASE}/api/database/${dbId}/raw?_t=${Date.now()}`;
                const response = await fetch(url);
                const result = await response.json();

                if (result.success) {
                    // Remove loading if still present
                    const loadingEl = container.querySelector('.loading-state');
                    if (loadingEl) loadingEl.remove();

                    // Render the raw data table with all columns
                    this.renderRawDatabaseTable(container, dbId, result);
                } else {
                    console.error(`Failed to fetch raw data for ${dbId}:`, result.error);
                }
            }

            // If no data was rendered, show message
            if (container.children.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Không có dữ liệu nào được tải.</div>';
            }
        } catch (err) {
            console.error('Error fetching raw data:', err);
            container.innerHTML = `<div class="error-state" style="padding:40px;text-align:center;color:#ef4444;">Lỗi: ${err.message}</div>`;
        }
    }

    renderRawDatabaseTable(container, dbId, result) {
        const { database_name, columns: originalColumns, data: originalData, total_records } = result;
        console.log(`[Frontend] Render table for ${dbId}:`, {
            name: database_name,
            total_records_api: total_records,
            data_length: originalData.length,
            first_record: originalData[0],
            last_record: originalData[originalData.length - 1]
        });

        // Check if section already exists
        let section = document.getElementById(`db-section-${dbId}`);
        if (!section) {
            section = document.createElement('div');
            section.id = `db-section-${dbId}`;
            section.className = 'db-section';
            container.appendChild(section);
        }

        // Prioritize Title Column for better visibility
        // High priority exact matches - Order matters!
        const priorityCandidates = ['TASKS', 'Tasks', 'Task Name', 'Task Main', 'Name', 'Subject', 'Project Name', 'Tên'];

        // Find the best match from the priority list
        let titleCol = null;
        for (const candidate of priorityCandidates) {
            if (originalColumns.includes(candidate)) {
                titleCol = candidate;
                break;
            }
        }

        // If no exact match, try regex (but skip "Title" generic for now to avoid bad matches)
        if (!titleCol) {
            titleCol = originalColumns.find(col => {
                const lower = col.toLowerCase();
                return (/name|task/i.test(col) && !/fix|point|status|type|date|time|user|person|by|at/i.test(lower)) && col !== 'Title';
            });
        }

        // Last resort: Title
        if (!titleCol && originalColumns.includes('Title')) {
            titleCol = 'Title';
        }

        if (titleCol) {
            console.log(`[Frontend] Selected '${titleCol}' as main column.`);
            const idx = originalColumns.indexOf(titleCol);
            if (idx > -1) {
                originalColumns.splice(idx, 1);
                originalColumns.unshift(titleCol);
            }
        }

        // FORCE REMOVE 'Title' if we selected something else (User request)
        if (titleCol && titleCol !== 'Title') {
            const genericTitleIdx = originalColumns.indexOf('Title');
            if (genericTitleIdx > -1) {
                originalColumns.splice(genericTitleIdx, 1);
                console.log('[Frontend] Removed redundant "Title" column.');
            }
        }

        // State management
        let columnOrder = [...originalColumns]; // For drag-drop reordering
        let hiddenColumns = new Set(); // For column visibility
        let filteredData = [...originalData];
        let sortColumn = null;
        let sortDirection = 'asc';
        let searchQuery = '';
        let currentPage = 1;
        let pageSize = 20;
        let showColumnPicker = false;

        // Get visible columns
        const getVisibleColumns = () => columnOrder.filter(col => !hiddenColumns.has(col));

        // Apply search and sort
        const applyFiltersAndSearch = () => {
            filteredData = originalData.filter(row => {
                // Global search across ALL columns
                if (searchQuery) {
                    const query = searchQuery.toLowerCase();
                    const matchesSearch = originalColumns.some(col => {
                        const value = String(row[col] || '').toLowerCase();
                        return value.includes(query);
                    });
                    if (!matchesSearch) return false;
                }
                return true;
            });

            // Apply sorting
            if (sortColumn) {
                filteredData.sort((a, b) => {
                    const aVal = a[sortColumn] || '';
                    const bVal = b[sortColumn] || '';

                    const aNum = parseFloat(aVal);
                    const bNum = parseFloat(bVal);
                    if (!isNaN(aNum) && !isNaN(bNum)) {
                        return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
                    }

                    const aStr = String(aVal).toLowerCase();
                    const bStr = String(bVal).toLowerCase();
                    return sortDirection === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
                });
            }

            currentPage = 1;
        };

        // Export to Excel (only visible columns)
        const exportToExcel = () => {
            const dataToExport = filteredData.length > 0 ? filteredData : originalData;
            const visibleCols = getVisibleColumns();
            const html = `
                <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
                <head><meta charset="UTF-8"></head>
                <body>
                    <table border="1">
                        <tr>${visibleCols.map(col => `<th style="background:#4a5568;color:white;font-weight:bold;">${col}</th>`).join('')}</tr>
                        ${dataToExport.map(row => `
                            <tr>${visibleCols.map(col => `<td>${this.escapeHtml(String(row[col] || ''))}</td>`).join('')}</tr>
                        `).join('')}
                    </table>
                </body>
                </html>
            `;
            const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${database_name.replace(/[^a-z0-9]/gi, '_')}.xls`;
            a.click();
            URL.revokeObjectURL(url);
        };

        // Render table
        const renderTable = () => {
            const visibleCols = getVisibleColumns();
            const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
            const start = (currentPage - 1) * pageSize;
            const end = Math.min(start + pageSize, filteredData.length);
            const pageData = filteredData.slice(start, end);

            const tableStyles = `
                <style>
                    #table-${dbId} th, #table-${dbId} td { border: 1px solid #475569; }
                    #table-${dbId} th { cursor: grab; user-select: none; }
                    #table-${dbId} th:hover { background: #334155; }
                    #table-${dbId} th.dragging { opacity: 0.5; background: #4f46e5; }
                    #table-${dbId} th.drag-over { border-left: 3px solid #4ade80; }
                    .sort-icon { margin-left: 4px; opacity: 0.5; }
                    .sort-icon.active { opacity: 1; color: #4ade80; }
                    .column-picker-${dbId} { 
                        position: absolute; right: 0; top: 100%; z-index: 100;
                        background: #1e293b; border: 1px solid #475569; border-radius: 8px;
                        padding: 8px; max-height: 300px; overflow-y: auto; min-width: 200px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    }
                    .column-picker-${dbId} label { display: flex; align-items: center; gap: 8px; padding: 4px 8px; cursor: pointer; color: #e2e8f0; font-size: 0.8rem; }
                    .column-picker-${dbId} label:hover { background: #334155; border-radius: 4px; }
                </style>
            `;

            let tableHtml = `
                ${tableStyles}
                <div class="report-card" style="background:#1e293b;border-radius:12px;margin-bottom:20px;overflow:hidden;">
                    <div class="report-card-header" style="padding:16px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                        <h4 style="margin:0;color:#f1f5f9;font-size:1rem;">${this.escapeHtml(database_name)}</h4>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <span style="background:#4ade80;color:#000;padding:4px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;">${filteredData.length}/${total_records}</span>
                            <button id="exportBtn-${dbId}" style="padding:6px 12px;background:#22c55e;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:0.8rem;font-weight:500;">📥 Export</button>
                        </div>
                    </div>
                    
                    <!-- Toolbar -->
                    <div style="padding:12px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#0f172a;">
                        <div style="display:flex;gap:8px;align-items:center;flex:1;max-width:400px;">
                            <span style="color:#94a3b8;font-size:0.85rem;">🔍</span>
                            <input type="text" id="searchInput-${dbId}" placeholder="Tìm kiếm tất cả cột..." 
                                value="${searchQuery}"
                                style="flex:1;padding:6px 10px;background:#1e293b;border:1px solid #475569;border-radius:4px;color:#e2e8f0;font-size:0.85rem;">
                            ${searchQuery ? `<button id="clearSearch-${dbId}" style="padding:4px 8px;background:#ef4444;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:0.75rem;">✕</button>` : ''}
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <!-- Column Visibility Toggle -->
                            <div style="position:relative;">
                                <button id="colPickerBtn-${dbId}" style="padding:6px 10px;background:#334155;border:none;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:0.8rem;">
                                    👁 Cột (${visibleCols.length}/${originalColumns.length})
                                </button>
                                ${showColumnPicker ? `
                                    <div class="column-picker-${dbId}">
                                        <div style="padding:4px 8px;border-bottom:1px solid #475569;margin-bottom:4px;">
                                            <button id="showAllCols-${dbId}" style="padding:3px 8px;background:#3b82f6;border:none;border-radius:3px;color:#fff;cursor:pointer;font-size:0.7rem;margin-right:4px;">Hiện tất cả</button>
                                            <button id="hideAllCols-${dbId}" style="padding:3px 8px;background:#ef4444;border:none;border-radius:3px;color:#fff;cursor:pointer;font-size:0.7rem;">Ẩn tất cả</button>
                                        </div>
                                        ${originalColumns.map(col => `
                                            <label>
                                                <input type="checkbox" class="col-toggle" data-col="${col}" ${!hiddenColumns.has(col) ? 'checked' : ''}>
                                                ${this.escapeHtml(col)}
                                            </label>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                            <select id="rawPageSize-${dbId}" style="padding:4px 8px;background:#1e293b;border:1px solid #475569;border-radius:4px;color:#e2e8f0;font-size:0.85rem;">
                                <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                                <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                                <option value="200" ${pageSize === 200 ? 'selected' : ''}>200</option>
                                <option value="${originalData.length}" ${pageSize >= originalData.length ? 'selected' : ''}>Tất cả</option>
                            </select>
                            <span style="color:#94a3b8;font-size:0.8rem;">${start + 1}-${end}/${filteredData.length}</span>
                        </div>
                    </div>
                    
                    <div class="report-card-body" style="overflow-x:auto;max-height:600px;overflow-y:auto;">
                        <table id="table-${dbId}" style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                            <thead style="background:#0f172a;position:sticky;top:0;z-index:10;">
                                <tr>
                                    ${visibleCols.map((col, idx) => `
                                        <th data-col="${col}" data-idx="${columnOrder.indexOf(col)}" draggable="true"
                                            style="padding:10px 12px;text-align:left;color:#94a3b8;font-weight:500;white-space:nowrap;background:#0f172a;">
                                            <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
                                                <span style="cursor:pointer;" data-sort="${col}">${this.escapeHtml(col)}</span>
                                                <span class="sort-icon ${sortColumn === col ? 'active' : ''}" data-sort="${col}">
                                                    ${sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                                                </span>
                                            </div>
                                        </th>
                                    `).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${pageData.length > 0 ? pageData.map((row, i) => `
                                    <tr style="${i % 2 === 0 ? 'background:#1e293b;' : 'background:#263548;'}">
                                        ${visibleCols.map(col => `
                                            <td style="padding:10px 12px;color:#e2e8f0;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" 
                                                title="${this.escapeHtml(String(row[col] || ''))}">
                                                ${this.escapeHtml(String(row[col] || ''))}
                                            </td>
                                        `).join('')}
                                    </tr>
                                `).join('') : `
                                    <tr><td colspan="${visibleCols.length}" style="padding:20px;text-align:center;color:#64748b;">Không có dữ liệu phù hợp</td></tr>
                                `}
                            </tbody>
                        </table>
                    </div>
                    
                    <!-- Pagination -->
                    ${totalPages > 1 ? `
                    <div style="padding:12px 20px;border-top:1px solid #334155;display:flex;justify-content:center;align-items:center;gap:8px;background:#0f172a;">
                        <button id="rawPrevBtn-${dbId}" style="padding:6px 12px;background:#334155;border:none;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:0.85rem;" ${currentPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>← Trước</button>
                        <span style="color:#94a3b8;font-size:0.85rem;">Trang ${currentPage} / ${totalPages}</span>
                        <button id="rawNextBtn-${dbId}" style="padding:6px 12px;background:#334155;border:none;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:0.85rem;" ${currentPage === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Sau →</button>
                    </div>
                    ` : ''}
                </div>
            `;

            section.innerHTML = tableHtml;

            // === Event Listeners ===

            // Export button
            document.getElementById(`exportBtn-${dbId}`)?.addEventListener('click', exportToExcel);

            // Search - with optimized debounce and focus preservation
            const searchInput = document.getElementById(`searchInput-${dbId}`);
            if (searchInput) {
                let debounceTimer;
                searchInput.addEventListener('input', (e) => {
                    clearTimeout(debounceTimer);
                    const cursorPos = e.target.selectionStart;
                    debounceTimer = setTimeout(() => {
                        searchQuery = e.target.value;
                        applyFiltersAndSearch();
                        renderTable();
                        // Restore focus after render
                        const newInput = document.getElementById(`searchInput-${dbId}`);
                        if (newInput) {
                            newInput.focus();
                            newInput.setSelectionRange(cursorPos, cursorPos);
                        }
                    }, 400); // Increased debounce for smoother typing
                });
            }

            // Clear search
            document.getElementById(`clearSearch-${dbId}`)?.addEventListener('click', () => {
                searchQuery = '';
                applyFiltersAndSearch();
                renderTable();
            });

            // Page size
            document.getElementById(`rawPageSize-${dbId}`)?.addEventListener('change', (e) => {
                pageSize = parseInt(e.target.value);
                currentPage = 1;
                renderTable();
            });

            // Pagination buttons
            document.getElementById(`rawPrevBtn-${dbId}`)?.addEventListener('click', () => {
                if (currentPage > 1) { currentPage--; renderTable(); }
            });
            document.getElementById(`rawNextBtn-${dbId}`)?.addEventListener('click', () => {
                if (currentPage < totalPages) { currentPage++; renderTable(); }
            });

            // Sort
            section.querySelectorAll('[data-sort]').forEach(el => {
                el.addEventListener('click', () => {
                    const col = el.dataset.sort;
                    if (sortColumn === col) {
                        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortColumn = col;
                        sortDirection = 'asc';
                    }
                    applyFiltersAndSearch();
                    renderTable();
                });
            });

            // Column Picker Toggle
            document.getElementById(`colPickerBtn-${dbId}`)?.addEventListener('click', (e) => {
                e.stopPropagation();
                showColumnPicker = !showColumnPicker;
                renderTable();
            });

            // Show/Hide All Columns
            document.getElementById(`showAllCols-${dbId}`)?.addEventListener('click', () => {
                hiddenColumns.clear();
                renderTable();
            });
            document.getElementById(`hideAllCols-${dbId}`)?.addEventListener('click', () => {
                originalColumns.forEach(col => hiddenColumns.add(col));
                renderTable();
            });

            // Individual Column Toggle
            section.querySelectorAll('.col-toggle').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => {
                    const col = e.target.dataset.col;
                    if (e.target.checked) {
                        hiddenColumns.delete(col);
                    } else {
                        hiddenColumns.add(col);
                    }
                    renderTable();
                });
            });

            // Close column picker when clicking outside
            document.addEventListener('click', (e) => {
                if (showColumnPicker && !e.target.closest(`#colPickerBtn-${dbId}`) && !e.target.closest(`.column-picker-${dbId}`)) {
                    showColumnPicker = false;
                    renderTable();
                }
            }, { once: true });

            // Drag and Drop for columns
            const table = document.getElementById(`table-${dbId}`);
            const headers = table?.querySelectorAll('th[draggable="true"]');
            let draggedIdx = null;

            headers?.forEach(th => {
                th.addEventListener('dragstart', (e) => {
                    draggedIdx = parseInt(th.dataset.idx);
                    th.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });

                th.addEventListener('dragend', () => {
                    th.classList.remove('dragging');
                    headers.forEach(h => h.classList.remove('drag-over'));
                });

                th.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    th.classList.add('drag-over');
                });

                th.addEventListener('dragleave', () => {
                    th.classList.remove('drag-over');
                });

                th.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const targetIdx = parseInt(th.dataset.idx);
                    if (draggedIdx !== null && draggedIdx !== targetIdx) {
                        // Reorder columns
                        const [removed] = columnOrder.splice(draggedIdx, 1);
                        columnOrder.splice(targetIdx, 0, removed);
                        renderTable();
                    }
                    th.classList.remove('drag-over');
                });
            });
        };

        renderTable();
    }

    renderSprintReport(container) {
        container.innerHTML = '<div class="report-content"><h3>Sprint Report</h3><p>Tính năng đang phát triển...</p></div>';
    }

    async renderProductivityReport(container) {
        // 1. Setup Container & Toolbar
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonthIdx = now.getMonth() + 1; // 1-12

        // Generate Year Options
        const yearOptions = [];
        for (let y = currentYear - 2; y <= currentYear + 2; y++) {
            yearOptions.push(`<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`);
        }

        // Generate Month Options
        const monthOptions = [];
        for (let m = 1; m <= 12; m++) {
            monthOptions.push(`<option value="${m}" ${m === currentMonthIdx ? 'selected' : ''}>Tháng ${m}</option>`);
        }

        container.innerHTML = `
            <div class="report-toolbar" style="background:#1e293b;padding:16px;border-radius:12px;margin-bottom:20px;border:1px solid #334155;">
                <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="color:#94a3b8;font-size:0.8rem;">Chọn Thời gian</label>
                        <div style="display:flex;gap:8px;">
                            <select id="prod-month-select" style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-family:inherit;min-width:100px;cursor:pointer;">
                                ${monthOptions.join('')}
                            </select>
                            <select id="prod-year-select" style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-family:inherit;width:80px;cursor:pointer;">
                                ${yearOptions.join('')}
                            </select>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="color:#94a3b8;font-size:0.8rem;">Số công chuẩn</label>
                        <input type="number" id="prod-std-days" placeholder="22" step="0.5"
                            style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:6px 10px;border-radius:6px;width:80px;font-family:inherit;">
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="color:#94a3b8;font-size:0.8rem;">Lọc Nhân sự</label>
                        <select id="prod-user-filter"
                            style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-family:inherit;min-width:150px;">
                            <option value="">Tất cả</option>
                        </select>
                    </div>
                    <div style="margin-left:auto;">
                        <button id="prod-refresh-btn" style="background:#3b82f6;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:500;">
                            🔄 Cập nhật
                        </button>
                    </div>
                </div>
                <div style="border-top:1px solid #334155;padding-top:12px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span style="color:#94a3b8;font-size:0.8rem;">📁 Database đã chọn:</span>
                        <span id="prod-db-count" style="color:#3b82f6;font-size:0.8rem;font-weight:500;"></span>
                        <button id="prod-toggle-dbs" style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:0.75rem;margin-left:auto;">
                            ▼ Thu gọn
                        </button>
                    </div>
                    <div id="prod-db-chips" style="display:flex;flex-wrap:wrap;gap:6px;max-height:120px;overflow-y:auto;"></div>
                </div>
            </div>
            <div id="prod-report-body" style="background:#1e293b;border-radius:12px;overflow:hidden;min-height:200px;border:1px solid #334155;">
                <div class="loading-state" style="padding:40px;text-align:center;color:#94a3b8;">Đang tải báo cáo...</div>
            </div>
        `;

        const monthSelect = document.getElementById('prod-month-select');
        const yearSelect = document.getElementById('prod-year-select');
        const stdDaysInput = document.getElementById('prod-std-days');
        const refreshBtn = document.getElementById('prod-refresh-btn');
        const bodyContainer = document.getElementById('prod-report-body');
        const userFilter = document.getElementById('prod-user-filter');
        const dbChipsContainer = document.getElementById('prod-db-chips');
        const dbCountSpan = document.getElementById('prod-db-count');
        const toggleDbsBtn = document.getElementById('prod-toggle-dbs');

        // Store full data for filtering
        let fullReportData = [];
        let reportColumns = [];
        let currentMonthStr = '';
        let chipsExpanded = true;  // Track chips panel state

        // NEW: State for column visibility, pagination
        let hiddenColumns = new Set();
        let currentPage = 1;
        let pageSize = 20;
        let showColumnPicker = false;
        const storageKey = 'prodReport_hiddenCols';

        // Load saved column config
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                JSON.parse(saved).forEach(c => hiddenColumns.add(c));
            }
        } catch (e) { /* ignore */ }

        // Helper: Get visible columns
        const getVisibleColumns = () => reportColumns.filter(c => !hiddenColumns.has(c.id));

        // Render database chips from selectedDatabases
        const renderDbChips = () => {
            const selectedIds = Array.from(this.selectedDatabases);
            dbCountSpan.textContent = `(${selectedIds.length})`;

            if (selectedIds.length === 0) {
                dbChipsContainer.innerHTML = '<span style="color:#64748b;font-size:0.8rem;">Chưa chọn database nào</span>';
                return;
            }

            dbChipsContainer.innerHTML = selectedIds.map(dbId => {
                const name = this.databaseNames.get(dbId) || dbId.slice(0, 8);
                return `
                    <label style="display:flex;align-items:center;gap:4px;background:#0f172a;padding:4px 8px;border-radius:4px;cursor:pointer;border:1px solid #334155;transition:all 0.15s;">
                        <input type="checkbox" checked data-db-id="${dbId}" class="prod-db-chip-checkbox" 
                            style="accent-color:#3b82f6;cursor:pointer;">
                        <span style="color:#e2e8f0;font-size:0.75rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                    </label>
                `;
            }).join('');

            // Add click handlers - auto refresh when toggling
            dbChipsContainer.querySelectorAll('.prod-db-chip-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const dbId = e.target.dataset.dbId;
                    if (e.target.checked) {
                        this.selectedDatabases.add(dbId);
                    } else {
                        this.selectedDatabases.delete(dbId);
                    }
                    this.savePersistedState();
                    renderDbChips();  // Update count
                    fetchReport();    // Auto-refresh report
                });
            });
        };

        // Toggle chips visibility
        toggleDbsBtn.addEventListener('click', () => {
            chipsExpanded = !chipsExpanded;
            dbChipsContainer.style.display = chipsExpanded ? 'flex' : 'none';
            toggleDbsBtn.textContent = chipsExpanded ? '▼ Thu gọn' : '▶ Mở rộng';
        });

        // Pre-populate databaseNames from projectsHierarchy
        for (const project of this.projectsHierarchy) {
            for (const db of (project.databases || [])) {
                if (db.id && db.name) {
                    this.databaseNames.set(db.id, db.name);
                }
            }
        }

        // Initial render of chips
        renderDbChips();

        const fetchReport = async () => {
            const m = monthSelect.value;
            const y = yearSelect.value;
            if (!m || !y) return;

            const monthStr = `${m.padStart(2, '0')}-${y}`; // MM-YYYY for Backend
            currentMonthStr = monthStr;

            bodyContainer.innerHTML = '<div class="loading-state" style="padding:40px;text-align:center;color:#94a3b8;">⏳ Đang tính toán dữ liệu...</div>';

            // Lấy database IDs đã chọn từ frontend state
            const selectedDbIds = Array.from(this.selectedDatabases);

            try {
                const response = await fetch(`${API_BASE}/api/reports/productivity`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ month: monthStr, databaseIds: selectedDbIds })
                });
                const result = await response.json();

                if (result.success) {
                    // Update Standard Days Input
                    if (result.stats?.standard_days) {
                        stdDaysInput.value = result.stats.standard_days;
                    }

                    // Store full data
                    fullReportData = result.data || [];
                    reportColumns = result.columns || [];
                    currentUnknownUsers = result.unknownUsers || [];

                    // Populate user filter dropdown
                    populateUserFilter(fullReportData);

                    // Render with current filter
                    applyFilterAndRender();
                } else {
                    bodyContainer.innerHTML = `<div class="error-state" style="padding:40px;text-align:center;color:#ef4444;">${result.error || 'Lỗi không xác định'}</div>`;
                }
            } catch (err) {
                console.error('Fetch Report Error:', err);
                bodyContainer.innerHTML = `<div class="error-state" style="padding:40px;text-align:center;color:#ef4444;">Lỗi kết nối: ${err.message}</div>`;
            }
        };

        const populateUserFilter = (data) => {
            const currentVal = userFilter.value;
            userFilter.innerHTML = '<option value="">Tất cả</option>';

            // Get unique names and sort alphabetically
            const names = [...new Set(data.map(r => r.fullName).filter(n => n))].sort();
            names.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                userFilter.appendChild(option);
            });

            // Restore previous selection if still valid
            if (names.includes(currentVal)) {
                userFilter.value = currentVal;
            }
        };

        let currentUnknownUsers = []; // State for unmapped users warnings

        const applyFilterAndRender = () => {
            const filterVal = userFilter.value;
            let filteredData = fullReportData;

            if (filterVal) {
                filteredData = fullReportData.filter(r => r.fullName === filterVal);
            }

            renderTable(filteredData, reportColumns, currentMonthStr);

            // Show Warning for Unmapped Users (Persistent)
            if (currentUnknownUsers.length > 0) {
                const warningHtml = `
                <div style="background:#451a03;color:#fbbf24;padding:12px;margin:16px;border-radius:8px;border:1px solid #92400e;font-size:0.9rem;">
                    <strong>⚠️ Phát hiện nhân sự chưa được mapping (Dữ liệu này đang bị ẩn):</strong><br>
                    <ul style="margin:4px 0 0 20px;padding:0;">
                        ${currentUnknownUsers.map(u => `<li>${u.name} (${u.taskCount} tasks)</li>`).join('')}
                    </ul>
                    <div style="margin-top:8px;font-size:0.8rem;opacity:0.8;">
                        Vui lòng báo Admin thêm "Name Alias" cho các tên này để hệ thống gộp đúng vào nhân sự chính thức.
                    </div>
                </div>`;
                bodyContainer.insertAdjacentHTML('afterbegin', warningHtml);
            }
        };

        // User filter change handler
        userFilter.addEventListener('change', applyFilterAndRender);

        const updateStats = async (updates) => {
            const m = monthSelect.value;
            const y = yearSelect.value;
            const monthStr = `${m.padStart(2, '0')}-${y}`;

            try {
                await fetch(`${API_BASE}/api/reports/productivity/update-stats`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ month: monthStr, updates })
                });
                // After update, refresh report to recalculate formulas
                fetchReport();
            } catch (err) {
                console.error('Update Stats Error:', err);
                alert('Không lưu được dữ liệu');
            }
        };

        const renderTable = (data, columns, monthStr) => {
            if (!data || data.length === 0) {
                bodyContainer.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Không có dữ liệu cho tháng này.</div>';
                return;
            }

            // Apply pagination
            const visibleCols = getVisibleColumns();
            const totalPages = Math.ceil(data.length / pageSize) || 1;
            const start = (currentPage - 1) * pageSize;
            const end = Math.min(start + pageSize, data.length);
            const pageData = data.slice(start, end);

            // Styles for the specialized table - DARK THEME
            const styles = `
                <style>
                    .prod-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; color: #e2e8f0; }
                    .prod-table th { background: #0f172a; padding: 10px; border: 1px solid #334155; text-align: left; font-weight: 600; white-space: nowrap; color: #94a3b8; }
                    .prod-table td { padding: 8px 10px; border: 1px solid #334155; background: #1e293b; }
                    .prod-table tr:hover td { background: #263548; }
                    .editable-cell { position: relative; }
                    .editable-cell input { 
                        width: 100%; border: 1px solid transparent; background: transparent; color: #e2e8f0;
                        padding: 4px; border-radius: 4px; text-align: right; 
                    }
                    .editable-cell input:hover { border-color: #475569; background: #0f172a; }
                    .editable-cell input:focus { border-color: #3b82f6; background: #0f172a; outline: none; }
                    .fill-handle {
                        position: absolute; bottom: 2px; right: 2px;
                        width: 8px; height: 8px;
                        background: #3b82f6; cursor: crosshair;
                        opacity: 0; transition: opacity 0.15s;
                        border: 1px solid #1e293b;
                    }
                    .editable-cell:hover .fill-handle { opacity: 1; }
                    .editable-cell.dragging .fill-handle { opacity: 1; background: #60a5fa; }
                    .editable-cell.fill-target { background: rgba(59, 130, 246, 0.2); }
                    .editable-cell.fill-target input { background: rgba(59, 130, 246, 0.1); border-color: #3b82f6; }
                    .num-cell { text-align: right; }
                    .prod-toolbar { display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 16px;background:#0f172a;border-bottom:1px solid #334155; }
                    .prod-toolbar-btn { padding:6px 12px;background:#334155;border:none;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:0.8rem;transition:all 0.15s; }
                    .prod-toolbar-btn:hover { background:#475569; }
                    .prod-toolbar-btn.primary { background:#3b82f6; }
                    .prod-toolbar-btn.primary:hover { background:#2563eb; }
                    .prod-toolbar-btn.success { background:#22c55e; }
                    .prod-toolbar-btn.success:hover { background:#16a34a; }
                    .prod-col-picker { position:absolute;right:0;top:100%;z-index:100;background:#1e293b;border:1px solid #475569;border-radius:8px;padding:8px;max-height:300px;overflow-y:auto;min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,0.3); }
                    .prod-col-picker label { display:flex;align-items:center;gap:8px;padding:4px 8px;cursor:pointer;color:#e2e8f0;font-size:0.8rem; }
                    .prod-col-picker label:hover { background:#334155;border-radius:4px; }
                    .prod-pagination { display:flex;gap:6px;align-items:center;justify-content:center;padding:12px;background:#0f172a;border-top:1px solid #334155; }
                    .prod-pagination-btn { padding:6px 12px;background:#334155;border:none;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:0.8rem; }
                    .prod-pagination-btn:hover:not(:disabled) { background:#475569; }
                    .prod-pagination-btn:disabled { opacity:0.5;cursor:not-allowed; }
                    .prod-pagination-btn.active { background:#3b82f6; }
                </style>
            `;

            let html = `
                ${styles}
                <!-- Toolbar -->
                <div class="prod-toolbar">
                    <div style="display:flex;gap:8px;align-items:center;">
                        <span style="color:#94a3b8;font-size:0.85rem;">📊 ${data.length} nhân sự</span>
                        <span style="color:#64748b;font-size:0.8rem;">|</span>
                        <span style="color:#94a3b8;font-size:0.8rem;">${visibleCols.length}/${columns.length} cột</span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <!-- Column Picker -->
                        <div style="position:relative;">
                            <button id="prod-col-picker-btn" class="prod-toolbar-btn">👁 Ẩn/Hiện cột</button>
                            ${showColumnPicker ? `
                                <div class="prod-col-picker">
                                    <div style="padding:4px 8px;border-bottom:1px solid #475569;margin-bottom:4px;display:flex;gap:4px;">
                                        <button id="prod-show-all-cols" class="prod-toolbar-btn" style="font-size:0.7rem;padding:3px 6px;">Hiện tất cả</button>
                                        <button id="prod-hide-all-cols" class="prod-toolbar-btn" style="font-size:0.7rem;padding:3px 6px;">Ẩn tất cả</button>
                                    </div>
                                    ${columns.filter(c => c.id !== 'stt').map(col => `
                                        <label>
                                            <input type="checkbox" class="prod-col-toggle" data-col-id="${col.id}" ${!hiddenColumns.has(col.id) ? 'checked' : ''}>
                                            ${col.name}
                                        </label>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <!-- Page Size -->
                        <select id="prod-page-size" class="prod-toolbar-btn" style="padding:4px 8px;">
                            <option value="10" ${pageSize === 10 ? 'selected' : ''}>10 dòng</option>
                            <option value="20" ${pageSize === 20 ? 'selected' : ''}>20 dòng</option>
                            <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 dòng</option>
                            <option value="100" ${pageSize === 100 ? 'selected' : ''}>100 dòng</option>
                            <option value="${data.length}" ${pageSize >= data.length ? 'selected' : ''}>Tất cả</option>
                        </select>
                        <span style="color:#94a3b8;font-size:0.8rem;">${start + 1}-${end}/${data.length}</span>
                        <!-- Export -->
                        <button id="prod-export-csv" class="prod-toolbar-btn success">📥 Export CSV</button>
                        <button id="prod-export-excel" class="prod-toolbar-btn success">📊 Export Excel</button>
                    </div>
                </div>
                <div style="overflow-x: auto; max-width: 100%;">
                    <table class="prod-table">
                        <thead>
                            <tr>
                                <th style="width: 50px;">STT</th>
                                ${visibleCols.filter(c => c.id !== 'stt').map(c => `<th>${c.name}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
            `;

            pageData.forEach((row, idx) => {
                const globalIdx = start + idx;
                html += `<tr>`;
                // STT
                html += `<td style="text-align:center;">${globalIdx + 1}</td>`;

                visibleCols.forEach(col => {
                    if (col.id === 'stt') return;

                    let val = row[col.id];
                    let cellContent = '';

                    // Formatting Logic
                    if (col.id === 'actualDays') {
                        // Editable Input with drag-fill handle
                        cellContent = `<div class="editable-cell" data-row-idx="${globalIdx}">
                            <input type="number" step="0.5" value="${val || 0}" data-person="${row.fullName}" data-row-idx="${globalIdx}" class="actual-days-input">
                            <div class="fill-handle" data-row-idx="${globalIdx}" title="Kéo để copy xuống"></div>
                        </div>`;
                    } else if (col.id === 'productivityReq') {
                        // KPI value - show as decimal number (6.30, 7.83, 9.46)
                        cellContent = `<div class="num-cell">${(parseFloat(val) || 0).toFixed(2)}</div>`;
                    } else if ([
                        'completionProdConfirmed',
                        'completionProdTotal',
                        'completionPointConfirmed',
                        'completionPointTotal',
                        'effortRatio'
                    ].includes(col.id)) {
                        // Percent for specific columns ONLY
                        const percent = (parseFloat(val) || 0) * 100;
                        cellContent = `<div class="num-cell">${percent.toFixed(1)}%</div>`;
                    } else if (typeof val === 'number') {
                        // Number (2 decimals for floats, 0 for integers?)
                        cellContent = `<div class="num-cell">${Number.isInteger(val) ? val : val.toFixed(2)}</div>`;
                    } else {
                        // Text
                        cellContent = val || '';
                    }

                    html += `<td data-col-id="${col.id}">${cellContent}</td>`;
                });
                html += `</tr>`;
            });

            html += `</tbody></table></div>`;

            // Pagination
            if (totalPages > 1) {
                html += `
                    <div class="prod-pagination">
                        <button class="prod-pagination-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>← Trước</button>
                        <span style="color:#94a3b8;font-size:0.85rem;">Trang ${currentPage} / ${totalPages}</span>
                        <button class="prod-pagination-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Sau →</button>
                    </div>
                `;
            }

            bodyContainer.innerHTML = html;

            // Helper: Recalculate row metrics client-side
            const recalculateRow = (row, personName, actualDays) => {
                const rowData = fullReportData.find(r => r.fullName === personName);
                if (!rowData) return;
                rowData.actualDays = actualDays; // Sync local data

                const kpi = rowData.productivityReq || 0;
                const pointTotal = rowData.pointTotal || 0;
                const pointConf = rowData.pointConfirmed || 0;
                const effortTotal = rowData.effortTotal || 0;

                // Formulas
                const pointReq = kpi * actualDays * 2; // C6
                const completionPointConf = pointReq ? (pointConf / pointReq) : 0; // C18
                const completionPointTotal = pointReq ? (pointTotal / pointReq) : 0; // C19
                const effortRatio = (actualDays * 2) ? (effortTotal / (actualDays * 2)) : 0; // C20 (New)

                // Update Cells
                const updateCell = (id, val, isPct) => {
                    const cell = row.querySelector(`[data-col-id="${id}"] .num-cell`);
                    if (cell) {
                        cell.textContent = isPct ? (val * 100).toFixed(1) + '%' : (Number.isInteger(val) ? val : val.toFixed(2));
                    }
                };

                updateCell('pointReq', pointReq, false);
                updateCell('completionPointConfirmed', completionPointConf, true);
                updateCell('completionPointTotal', completionPointTotal, true);
                updateCell('effortRatio', effortRatio, true);
            };

            // Get all actual-days inputs for drag and paste operations
            const allInputs = Array.from(bodyContainer.querySelectorAll('.actual-days-input'));

            // Add Event Listeners for Inputs
            allInputs.forEach((input, inputIdx) => {
                // Normal change handler
                input.addEventListener('change', (e) => {
                    const person = e.target.dataset.person;
                    const val = parseFloat(e.target.value) || 0;
                    updateStats({ actual_days: { [person]: val } });

                    const row = e.target.closest('tr');
                    recalculateRow(row, person, val);
                });

                // Keyboard navigation (Enter/Tab to move, Ctrl+D to fill down)
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const nextInput = allInputs[inputIdx + 1];
                        if (nextInput) nextInput.focus();
                    }

                    // Ctrl+D: Copy current value to all rows below
                    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                        e.preventDefault();
                        const currentVal = parseFloat(e.target.value) || 0;
                        const updates = {};

                        for (let i = inputIdx; i < allInputs.length; i++) {
                            allInputs[i].value = currentVal;
                            const person = allInputs[i].dataset.person;
                            updates[person] = currentVal;

                            const row = allInputs[i].closest('tr');
                            recalculateRow(row, person, currentVal);
                        }

                        updateStats({ actual_days: updates });
                    }
                });

                // Paste handler: support pasting multiple values (one per line)
                input.addEventListener('paste', (e) => {
                    const pasteData = e.clipboardData.getData('text');
                    const lines = pasteData.split(/[\r\n]+/).map(l => l.trim()).filter(l => l);

                    if (lines.length > 1) {
                        e.preventDefault();
                        const updates = {};

                        for (let i = 0; i < lines.length && inputIdx + i < allInputs.length; i++) {
                            const val = parseFloat(lines[i].replace(',', '.')) || 0;
                            allInputs[inputIdx + i].value = val;
                            const person = allInputs[inputIdx + i].dataset.person;
                            updates[person] = val;
                        }

                        updateStats({ actual_days: updates });
                    }
                });
            });

            // Drag-fill functionality
            let dragState = null;
            const allCells = Array.from(bodyContainer.querySelectorAll('.editable-cell'));
            const allHandles = Array.from(bodyContainer.querySelectorAll('.fill-handle'));

            allHandles.forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const startIdx = parseInt(handle.dataset.rowIdx);
                    const startInput = allInputs[startIdx];
                    const startValue = parseFloat(startInput?.value) || 0;

                    dragState = { startIdx, startValue, currentIdx: startIdx };
                    allCells[startIdx]?.classList.add('dragging');
                });
            });

            bodyContainer.addEventListener('mousemove', (e) => {
                if (!dragState) return;

                // Find which row the mouse is over
                const target = e.target.closest('.editable-cell');
                if (!target) return;

                const hoverIdx = parseInt(target.dataset.rowIdx);
                if (isNaN(hoverIdx)) return;

                // Clear previous highlights
                allCells.forEach(c => c.classList.remove('fill-target'));

                // Highlight range from start to current
                const minIdx = Math.min(dragState.startIdx, hoverIdx);
                const maxIdx = Math.max(dragState.startIdx, hoverIdx);

                for (let i = minIdx; i <= maxIdx; i++) {
                    allCells[i]?.classList.add('fill-target');
                }

                dragState.currentIdx = hoverIdx;
            });

            const finishDrag = () => {
                if (!dragState) return;

                const { startIdx, startValue, currentIdx } = dragState;
                const minIdx = Math.min(startIdx, currentIdx);
                const maxIdx = Math.max(startIdx, currentIdx);

                const updates = {};
                for (let i = minIdx; i <= maxIdx; i++) {
                    if (allInputs[i]) {
                        allInputs[i].value = startValue;
                        const person = allInputs[i].dataset.person;
                        updates[person] = startValue;

                        const row = allInputs[i].closest('tr');
                        recalculateRow(row, person, startValue);
                    }
                }

                if (Object.keys(updates).length > 0) {
                    updateStats({ actual_days: updates });
                }

                // Clear highlights
                allCells.forEach(c => {
                    c.classList.remove('dragging', 'fill-target');
                });

                dragState = null;
            };

            bodyContainer.addEventListener('mouseup', finishDrag);
            bodyContainer.addEventListener('mouseleave', finishDrag);

            // === NEW: Event listeners for toolbar ===

            // Column Picker Toggle
            document.getElementById('prod-col-picker-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                showColumnPicker = !showColumnPicker;
                applyFilterAndRender();
            });

            // Show All Columns
            document.getElementById('prod-show-all-cols')?.addEventListener('click', () => {
                hiddenColumns.clear();
                localStorage.setItem(storageKey, JSON.stringify([]));
                applyFilterAndRender();
            });

            // Hide All Columns
            document.getElementById('prod-hide-all-cols')?.addEventListener('click', () => {
                columns.filter(c => c.id !== 'stt').forEach(c => hiddenColumns.add(c.id));
                localStorage.setItem(storageKey, JSON.stringify([...hiddenColumns]));
                applyFilterAndRender();
            });

            // Individual Column Toggle
            bodyContainer.querySelectorAll('.prod-col-toggle').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const colId = e.target.dataset.colId;
                    if (e.target.checked) {
                        hiddenColumns.delete(colId);
                    } else {
                        hiddenColumns.add(colId);
                    }
                    localStorage.setItem(storageKey, JSON.stringify([...hiddenColumns]));
                    applyFilterAndRender();
                });
            });

            // Page Size
            document.getElementById('prod-page-size')?.addEventListener('change', (e) => {
                pageSize = parseInt(e.target.value);
                currentPage = 1;
                applyFilterAndRender();
            });

            // Pagination Buttons
            bodyContainer.querySelectorAll('.prod-pagination-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) {
                        currentPage = page;
                        applyFilterAndRender();
                    }
                });
            });

            // Close column picker when clicking outside
            document.addEventListener('click', (e) => {
                if (showColumnPicker && !e.target.closest('#prod-col-picker-btn') && !e.target.closest('.prod-col-picker')) {
                    showColumnPicker = false;
                    applyFilterAndRender();
                }
            }, { once: true });

            // Export CSV - dùng dấu chấm phẩy (;) cho Excel Việt Nam
            document.getElementById('prod-export-csv')?.addEventListener('click', () => {
                const visibleCols = getVisibleColumns();
                const csv = [
                    ['STT', ...visibleCols.filter(c => c.id !== 'stt').map(c => c.name)].join(';'),
                    ...data.map((row, idx) => {
                        const cells = [(idx + 1).toString()];
                        visibleCols.filter(c => c.id !== 'stt').forEach(col => {
                            let val = row[col.id];
                            if ([
                                'completionProdConfirmed', 'completionProdTotal',
                                'completionPointConfirmed', 'completionPointTotal', 'effortRatio'
                            ].includes(col.id)) {
                                val = ((parseFloat(val) || 0) * 100).toFixed(1) + '%';
                            } else if (typeof val === 'number') {
                                val = Number.isInteger(val) ? val.toString() : val.toFixed(2);
                            }
                            // Escape dấu chấm phẩy và dấu ngoặc kép
                            cells.push(`"${String(val || '').replace(/"/g, '""')}"`);
                        });
                        return cells.join(';');
                    })
                ].join('\n');

                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Bao_cao_nang_suat_${currentMonthStr}.csv`;
                a.click();
                URL.revokeObjectURL(url);
            });

            // Export Excel
            document.getElementById('prod-export-excel')?.addEventListener('click', () => {
                const visibleCols = getVisibleColumns();
                const excelHtml = `
                    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
                    <head><meta charset="UTF-8"></head>
                    <body>
                        <table border="1">
                            <tr>
                                <th style="background:#0f172a;color:white;font-weight:bold;">STT</th>
                                ${visibleCols.filter(c => c.id !== 'stt').map(c => `<th style="background:#0f172a;color:white;font-weight:bold;">${c.name}</th>`).join('')}
                            </tr>
                            ${data.map((row, idx) => `
                                <tr>
                                    <td>${idx + 1}</td>
                                    ${visibleCols.filter(c => c.id !== 'stt').map(col => {
                    let val = row[col.id];
                    if ([
                        'completionProdConfirmed', 'completionProdTotal',
                        'completionPointConfirmed', 'completionPointTotal', 'effortRatio'
                    ].includes(col.id)) {
                        val = ((parseFloat(val) || 0) * 100).toFixed(1) + '%';
                    } else if (typeof val === 'number') {
                        val = Number.isInteger(val) ? val : val.toFixed(2);
                    }
                    return `<td>${val || ''}</td>`;
                }).join('')}
                                </tr>
                            `).join('')}
                        </table>
                    </body>
                    </html>
                `;

                const blob = new Blob(['\uFEFF' + excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Bao_cao_nang_suat_${currentMonthStr}.xls`;
                a.click();
                URL.revokeObjectURL(url);
            });
        };

        // Event Listeners
        refreshBtn.addEventListener('click', fetchReport);
        monthSelect.addEventListener('change', fetchReport);
        yearSelect.addEventListener('change', fetchReport);

        stdDaysInput.addEventListener('change', async (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) {
                await updateStats({ standard_days: val });
            }
        });

        // Initial Load
        fetchReport();
    }

    async loadProjectsTree() {
        const treeContainer = document.getElementById('project-tree');
        if (treeContainer) treeContainer.innerHTML = '<div class="loading-spinner">Loading projects...</div>';

        try {
            const response = await fetch(`${API_BASE}/api/projects/tree?status=active`);
            const data = await response.json();

            if (data.success) {
                this.projectsHierarchy = data.projects || data.tree; // Expecting { projects: [...] }
                this.renderProjectsTreeHierarchical();

                // Auto-fetch if we have selections
                if (this.selectedDatabases.size > 0 && !this.initialFetchDone) {
                    this.initialFetchDone = true;
                    // Provide feedback
                    this.showLoading(`Restoring ${this.selectedDatabases.size} databases...`);
                    // Use cache preference = true
                    setTimeout(() => this.fetchSelectedDatabases(true), 500);
                }
            } else {
                console.warn('API error:', data.error);
                this.showError('Failed to load project tree.');
            }
        } catch (error) {
            console.error('Network error loading projects:', error);
            this.showError('Network error. Check server.');
        }
    }

    /**
     * Renders sidebar with Whitelist filtering and Status grouping
     */
    renderProjectsTreeHierarchical() {
        const treeContainer = document.getElementById('project-tree');
        if (!treeContainer || !this.projectsHierarchy) return;

        const scrollPos = treeContainer.scrollTop;
        const query = this.searchQuery.toLowerCase();
        let mainHtml = '';

        // Whitelist project keywords
        // Whitelist project keywords - Pinned to top
        const WHITELIST_KEYWORDS = [
            'DeeDee_2025', 'DeeDee_2026', // Catch-all for new projects
            'Disk Knight', 'SHAVUOT', 'NINJAGO', 'FC MOBILE',
            'HARRY', 'MIRACULOUS', 'XANHSM',
            'KNIGHTS', 'GENEVIEVE', 'Sunny Side',
            'Đại Hiệp', 'UPZI', 'Mami'
        ];

        // 1. Filter & Group
        const pinnedProjects = [];
        const otherProjects = [];
        const hiddenProjectsList = [];

        for (const project of this.projectsHierarchy) {
            // Search filter
            const matchesSearch = !query ||
                project.name.toLowerCase().includes(query) ||
                (project.databases && project.databases.some(db => db.name.toLowerCase().includes(query)));

            if (!matchesSearch) continue;

            const isPinned = WHITELIST_KEYWORDS.some(k => project.name.toLowerCase().includes(k.toLowerCase()));

            if (isPinned) {
                pinnedProjects.push(project);
                continue; // Pinned projects are never hidden
            }

            // Hidden Check (Only effective for non-pinned)
            const isHidden = this.hiddenProjects.has(project.name) && !query;

            if (isHidden) {
                hiddenProjectsList.push(project);
                continue;
            }

            otherProjects.push(project);
        }

        // 2. Render Pinned Projects (Flat List)
        let hasPinnedContent = false;
        if (pinnedProjects.length > 0) {
            hasPinnedContent = true;
            mainHtml += `<div class="pinned-projects-header" style="padding: 8px 16px; font-size: 0.75rem; color: #94a3b8; font-weight: 600; text-transform: uppercase;">Projects</div>`;
            mainHtml += this.renderProjectList(pinnedProjects);
        }



        // 3. Render Hidden Projects Section (If any)
        if (hiddenProjectsList.length > 0) {
            mainHtml += `
                <div class="other-projects-header" onclick="app.toggleHiddenProjectsSection()" style="margin-top: 20px; border-top: 1px dashed #475569;">
                    ${this.isHiddenProjectsOpen ? '▼' : '▶'} Dự án đã ẩn (${hiddenProjectsList.length})
                </div>
            `;
            if (this.isHiddenProjectsOpen) {
                mainHtml += `<div id="hidden-projects-list">${this.renderProjectList(hiddenProjectsList, true)}</div>`;
            }
        }

        // 4. Render Other Projects (Collapsed)
        if (otherProjects.length > 0) {
            const style = this.isHiddenGroupOpen ? 'display: block;' : 'display: none;';
            const arrow = this.isHiddenGroupOpen ? '▼' : '▶';

            mainHtml += `
                <div class="other-projects-header" onclick="app.toggleHiddenGroup()">
                    ${arrow} Dự án khác (${otherProjects.length})
                </div>
                <div id="other-projects-list" style="${style}">
                    ${this.renderProjectList(otherProjects)}
                </div>
            `;
        }

        if (!hasPinnedContent && otherProjects.length === 0 && hiddenProjectsList.length === 0) {
            mainHtml = '<div class="no-data" style="padding:20px; text-align:center; color:#64748b;">Không tìm thấy kết quả</div>';
        }

        treeContainer.innerHTML = mainHtml;

        // Restore scroll
        if (scrollPos > 0) treeContainer.scrollTop = scrollPos;
    }

    renderProjectList(projects, isHiddenSection = false) {
        let html = '';
        for (const project of projects) {
            const safeProjectName = this.escapeHtml(project.name);
            // Name Simplification Reverted as per user request
            const projectId = `project-${this.hashString(project.name)}`;
            const databases = project.databases || [];

            // if (databases.length === 0) continue; // Allow displaying empty projects for debug

            // Determine if expanded
            const isProjectSelected = this.selectedProjects.has(project.name);
            const visibleDatabases = databases.filter(db => !this.hiddenDatabases.has(db.id));
            const hasSelections = visibleDatabases.some(db => this.selectedDatabases.has(db.id));
            const isExpanded = isProjectSelected || hasSelections;

            // Count databases for project label
            const dbCount = visibleDatabases.length;
            const projectCountLabel = `<span class="project-count-badge" style="background:#3b82f6;color:#fff;padding:2px 6px;border-radius:10px;font-size:0.7rem;margin-left:8px;">${dbCount}</span>`;

            // Status Badge
            const status = project.status || 'Unknown';
            let statusColor = '#94a3b8'; // Default gray
            if (status === 'In Progress') statusColor = '#3b82f6';
            else if (status === 'Done') statusColor = '#22c55e';
            else if (status === 'Planning') statusColor = '#f59e0b';
            else if (status === 'Paused') statusColor = '#ef4444';

            const statusBadge = `<span style="display:inline-block;margin-left:8px;padding:2px 6px;border-radius:4px;background:${statusColor}20;color:${statusColor};font-size:0.65rem;border:1px solid ${statusColor}40;">${status}</span>`;

            // Visibility Icon
            const eyeIcon = isHiddenSection ? 'strikethrough-eye' : 'eye'; // Simplified icon logic
            const eyeTitle = isHiddenSection ? 'Hiện dự án' : 'Ẩn dự án';
            const eyeAction = `event.stopPropagation(); app.toggleProjectVisibility('${safeProjectName.replace(/'/g, "\\'")}')`;
            // Note: toggleProjectVisibility logic handles boolean toggle.

            html += `
                <div class="project-group">
                     <div class="project-header" data-project="${safeProjectName}" onclick="app.toggleProjectExpand('${projectId}-databases', this)">
                        <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
                        <div class="project-label" title="${safeProjectName}" style="display:flex;align-items:center;">
                            ${safeProjectName}
                            ${statusBadge}
                            ${projectCountLabel}
                        </div>
                        
                        <!-- Toggle Project Visibility -->
                         <div class="visibility-toggle" onclick="${eyeAction}" title="${eyeTitle}">
                            ${isHiddenSection ? '🚫' : '👁'}
                         </div>
                    </div>


                    <ul class="database-list ${isExpanded ? 'expanded' : ''}" id="${projectId}-databases">
                         ${visibleDatabases.map(db => {
                const dbId = `db-${db.id}`;
                const isDbSelected = this.selectedDatabases.has(db.id);
                const safeDbName = this.escapeHtml(db.name);
                const dbIcon = this.getDatabaseIcon(db.type);

                // RECORD COUNT
                const count = this.databaseCounts[db.id];
                // Show counts if available with styled badge
                const countLabel = (count !== undefined)
                    ? `<span class="db-count-badge" style="background:#22c55e;color:#000;padding:1px 6px;border-radius:10px;font-size:0.65rem;margin-left:6px;font-weight:600;">${count}</span>`
                    : ''; // Don't show anything if not loaded to keep clean

                return `
                                <li class="database-item">
                                    <input type="checkbox" id="${dbId}" 
                                        class="database-checkbox"
                                        data-db-id="${db.id}" 
                                        data-db-name="${safeDbName}"
                                        data-project="${safeProjectName}"
                                        ${isDbSelected ? 'checked' : ''}
                                        onchange="app.handleDatabaseCheckbox(this)">
                                    <label for="${dbId}" title="${safeDbName}">
                                        ${dbIcon} ${safeDbName}
                                        ${countLabel}
                                    </label>
                                     <div class="visibility-toggle-small" 
                                            onclick="event.stopPropagation(); app.toggleDatabaseVisibility('${db.id}')"
                                            title="Ẩn database">👁</div>
                                </li>
                            `;
            }).join('')}
                    </ul>
                </div>
            `;
        }
        return html;
    }

    toggleHiddenProjectsSection() {
        this.isHiddenProjectsOpen = !this.isHiddenProjectsOpen;
        this.renderProjectsTreeHierarchical();
    }

    toggleHiddenGroup() {
        this.isHiddenGroupOpen = !this.isHiddenGroupOpen;
        this.renderProjectsTreeHierarchical();
    }

    // ACTIONS

    async fetchSelectedDatabases(useCache = false) {
        if (this.selectedDatabases.size === 0) {
            this.clearMainView();
            return;
        }

        const dbIds = Array.from(this.selectedDatabases);
        this.showLoading(`Fetching ${dbIds.length} databases...`);

        try {
            // Fetch one by one to show progress, or batch? Batch is better for User, one by one is better for Progress UI.
            // Let's use simple logic: Loop fetch.

            for (const dbId of dbIds) {
                // If we want to force refresh, append ?refresh=true
                // If we want cache, rely on backend cache logic
                const url = `${API_BASE}/api/projects/database/${dbId}`;

                // If using cache, we assume backend handles it. But backend cache might be in-memory.
                // If we really want to avoid wait time on reload, we need backend to persist or use browser cache.
                // For now, let's rely on backend speed.

                const response = await fetch(url);
                const result = await response.json();

                if (result.success) {
                    // Update Count
                    this.updateDatabaseCounts(dbId, result.data.length);
                    // Render Table (Simplified for this snippet)
                    this.renderDatabaseData(dbId, result.data, result.meta);
                } else {
                    console.error(`Failed to fetch ${dbId}`);
                }
            }
        } catch (e) {
            console.error(e);
            this.showError('Error fetching data');
        } finally {
            this.hideLoading();
        }
    }

    handleDatabaseCheckbox(checkbox) {
        const dbId = checkbox.dataset.dbId;
        const dbName = checkbox.dataset.dbName;

        // Store name for chip display
        if (dbName) {
            this.databaseNames.set(dbId, dbName);
        }

        if (checkbox.checked) {
            this.selectedDatabases.add(dbId);
        } else {
            this.selectedDatabases.delete(dbId);
            this.removeDatabaseView(dbId);
        }

        this.savePersistedState();
        this.updateGenerateButtonState();

        // Don't auto-fetch here - wait for user to click "Tạo Báo Cáo" button
    }

    toggleProjectVisibility(projectName) {
        if (this.hiddenProjects.has(projectName)) {
            this.hiddenProjects.delete(projectName);
        } else {
            this.hiddenProjects.add(projectName);
        }
        this.savePersistedState();
        this.renderProjectsTreeHierarchical();
    }

    toggleDatabaseVisibility(dbId) {
        if (this.hiddenDatabases.has(dbId)) {
            this.hiddenDatabases.delete(dbId);
        } else {
            this.hiddenDatabases.add(dbId);
        }
        this.savePersistedState();
        this.renderProjectsTreeHierarchical();
    }

    toggleHiddenGroup() {
        this.isHiddenGroupOpen = !this.isHiddenGroupOpen;
        this.renderProjectsTreeHierarchical();
    }

    toggleProjectExpand(elementId, header) {
        const el = document.getElementById(elementId);
        const icon = header.querySelector('.expand-icon');
        if (el) {
            el.classList.toggle('expanded');
            if (icon) icon.textContent = el.classList.contains('expanded') ? '▼' : '▶';
        }
    }

    // UPDATERS

    updateDatabaseCounts(dbId, count) {
        this.databaseCounts[dbId] = count;
        // Re-render only if needed, or find element and update
        // Full re-render is safe
        this.renderProjectsTreeHierarchical();
    }

    clearMainView() {
        const container = document.getElementById('report-container');
        if (container) container.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Chọn database để xem dữ liệu</div>';
    }

    removeDatabaseView(dbId) {
        const el = document.getElementById(`db-section-${dbId}`);
        if (el) el.remove();
    }

    renderDatabaseData(dbId, data, meta) {
        const container = document.getElementById('report-container');
        if (!container) return;

        // Remove "loading" message if present
        const loadingEl = container.querySelector('.loading-state');
        if (loadingEl) loadingEl.remove();

        // Check if section for this DB already exists
        let section = document.getElementById(`db-section-${dbId}`);
        if (!section) {
            section = document.createElement('div');
            section.id = `db-section-${dbId}`;
            section.className = 'db-section';
            container.appendChild(section);
        }

        // Build Table with Pagination
        const dbName = meta?.title || dbId;
        const headers = data.length > 0 ? Object.keys(data[0]) : [];

        // Pagination state
        let currentPage = 1;
        let pageSize = 20; // Default: 20 rows

        const renderTable = () => {
            const totalPages = Math.ceil(data.length / pageSize);
            const start = (currentPage - 1) * pageSize;
            const end = Math.min(start + pageSize, data.length);
            const pageData = data.slice(start, end);

            let tableHtml = `
                <div class="report-card" style="background:#1e293b;border-radius:12px;margin-bottom:20px;overflow:hidden;">
                    <div class="report-card-header" style="padding:16px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                        <h4 style="margin:0;color:#f1f5f9;font-size:1rem;">${this.escapeHtml(dbName)}</h4>
                        <span style="background:#4ade80;color:#000;padding:4px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;">${data.length} bản ghi</span>
                    </div>
                    
                    <!-- Pagination Controls Top -->
                    <div style="padding:12px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#0f172a;">
                        <div style="display:flex;gap:8px;align-items:center;">
                            <span style="color:#94a3b8;font-size:0.85rem;">Hiển thị:</span>
                            <select id="pageSize-${dbId}" style="padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:0.85rem;">
                                <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                                <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                                <option value="200" ${pageSize === 200 ? 'selected' : ''}>200</option>
                                <option value="${data.length}" ${pageSize >= data.length ? 'selected' : ''}>Tất cả</option>
                            </select>
                            <span style="color:#94a3b8;font-size:0.85rem;">dòng</span>
                        </div>
                        <span style="color:#94a3b8;font-size:0.85rem;">Đang hiển thị ${start + 1}-${end} / ${data.length}</span>
                    </div>
                    
                    <div class="report-card-body" style="overflow-x:auto;max-height:600px;overflow-y:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                            <thead style="background:#0f172a;position:sticky;top:0;">
                                <tr>
                                    ${headers.map(h => `<th style="padding:12px 16px;text-align:left;color:#94a3b8;font-weight:500;white-space:nowrap;">${this.escapeHtml(h)}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${pageData.map((row, i) => `
                                    <tr style="border-bottom:1px solid #334155;${i % 2 === 0 ? 'background:#1e293b;' : 'background:#263548;'}">
                                        ${headers.map(h => `<td style="padding:10px 16px;color:#e2e8f0;max-width:300px;overflow:hidden;text-overflow:ellipsis;">${this.formatCell(row[h])}</td>`).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    <!-- Pagination Controls Bottom -->
                    ${totalPages > 1 ? `
                    <div style="padding:12px 20px;border-top:1px solid #334155;display:flex;justify-content:center;align-items:center;gap:8px;background:#0f172a;">
                        <button id="prevBtn-${dbId}" style="padding:6px 12px;background:#334155;border:none;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:0.85rem;" ${currentPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>← Trước</button>
                        <span style="color:#94a3b8;font-size:0.85rem;">Trang ${currentPage} / ${totalPages}</span>
                        <button id="nextBtn-${dbId}" style="padding:6px 12px;background:#334155;border:none;border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:0.85rem;" ${currentPage === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Sau →</button>
                    </div>
                    ` : ''}
                </div>
            `;

            section.innerHTML = tableHtml;

            // Attach event listeners
            const pageSizeSelect = document.getElementById(`pageSize-${dbId}`);
            if (pageSizeSelect) {
                pageSizeSelect.addEventListener('change', (e) => {
                    pageSize = parseInt(e.target.value);
                    currentPage = 1;
                    renderTable();
                });
            }

            const prevBtn = document.getElementById(`prevBtn-${dbId}`);
            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    if (currentPage > 1) {
                        currentPage--;
                        renderTable();
                    }
                });
            }

            const nextBtn = document.getElementById(`nextBtn-${dbId}`);
            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    const totalPages = Math.ceil(data.length / pageSize);
                    if (currentPage < totalPages) {
                        currentPage++;
                        renderTable();
                    }
                });
            }
        };

        renderTable();
    }

    formatCell(value) {
        if (value === null || value === undefined) return '<span style="color:#475569;">—</span>';
        if (typeof value === 'object') {
            // Handle Notion-specific formats
            if (Array.isArray(value)) return this.escapeHtml(value.join(', '));
            return this.escapeHtml(JSON.stringify(value));
        }
        return this.escapeHtml(String(value));
    }

    // UTILS

    showLoading(msg) {
        // Implement loading overlay
        const loader = document.getElementById('global-loader');
        if (loader) {
            loader.style.display = 'flex';
            const txt = loader.querySelector('.loading-text');
            if (txt) txt.textContent = msg;
        }
    }

    hideLoading() {
        const loader = document.getElementById('global-loader');
        if (loader) loader.style.display = 'none';
    }

    showError(msg) {
        alert(msg); // Simple alert for now
    }

    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return "id" + Math.abs(hash);
    }

    getStatusIcon(status) {
        const icons = {
            'In Progress': '●',
            'Planning': '●',
            'Backlog': '●',
            'Paused': '⏸️',
            'Seedbed': '🌱',
            'Done': '✓'
        };
        return icons[status] || '●';
    }

    getDatabaseIcon(type) {
        const icons = {
            'tasks': '✅',
            'products': '📦',
            'sprints': '🏃',
            'docs': '📄',
            'reports': '📊',
            'issues': '🐛',
            'other': '🗄️'
        };
        return icons[type] || '🗄️';
    }

    startPolling() {
        setInterval(() => {
            // Optional: check for updates
        }, 60000);
    }
}

// Initialize
// const app = new DashboardApp(); // Managed by AuthManager now
// document.addEventListener('DOMContentLoaded', () => app.init());
// Expose for AuthManager
window.DashboardApp = DashboardApp;
window.app = new DashboardApp(); // Create instance but don't init

