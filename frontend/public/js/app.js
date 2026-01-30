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
        this.isHiddenGroupOpen = false;
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

    renderProductivityReport(container) {
        container.innerHTML = '<div class="report-content"><h3>Productivity Report</h3><p>Tính năng đang phát triển...</p></div>';
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
        const WHITELIST_KEYWORDS = [
            'Disk Knight', 'SHAVUOT', 'NINJAGO', 'FC MOBILE',
            'HARRY', 'MIRACULOUS', 'XANHSM',
            'KNIGHTS', 'GENEVIEVE', 'Sunny Side',
            'Đại Hiệp', 'UPZI', 'LEGO', 'Victory',
            'Immortals', 'Mami', 'GEN', 'HAR', 'LEG'
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

            // Hidden Check (Only effective if NO search query)
            // If searching, show everything matching
            const isHidden = this.hiddenProjects.has(project.name) && !query;

            if (isHidden) {
                hiddenProjectsList.push(project);
                continue;
            }

            const isPinned = WHITELIST_KEYWORDS.some(k => project.name.toLowerCase().includes(k.toLowerCase()));

            if (isPinned) {
                pinnedProjects.push(project);
            } else {
                otherProjects.push(project);
            }
        }

        // 2. Render Pinned Projects by Status
        const statusGroups = {};
        for (const project of pinnedProjects) {
            const status = project.status || 'Unknown';
            if (!statusGroups[status]) statusGroups[status] = [];
            statusGroups[status].push(project);
        }

        const statusOrder = ['In Progress', 'Done', 'Planning', 'Backlog', 'Paused', 'Seedbed'];

        // Render by Status (Pinned)
        let hasPinnedContent = false;
        for (const status of statusOrder) {
            const projects = statusGroups[status];
            if (!projects || projects.length === 0) continue;

            hasPinnedContent = true;
            const statusIcon = this.getStatusIcon(status);
            mainHtml += `
                <div class="status-group-header" data-status="${status}">
                    <span class="status-icon">${statusIcon}</span>
                    <span class="status-label">${status}</span>
                    <span class="status-count">${projects.length}</span>
                </div>
            `;
            mainHtml += this.renderProjectList(projects);
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
            const projectId = `project-${this.hashString(project.name)}`;
            const databases = project.databases || [];

            if (databases.length === 0) continue;

            // Determine if expanded
            const isProjectSelected = this.selectedProjects.has(project.name);
            const visibleDatabases = databases.filter(db => !this.hiddenDatabases.has(db.id));
            const hasSelections = visibleDatabases.some(db => this.selectedDatabases.has(db.id));
            const isExpanded = isProjectSelected || hasSelections;

            // Count databases for project label
            const dbCount = visibleDatabases.length;
            const projectCountLabel = `<span class="project-count-badge" style="background:#3b82f6;color:#fff;padding:2px 6px;border-radius:10px;font-size:0.7rem;margin-left:8px;">${dbCount}</span>`;

            // Visibility Icon
            const eyeIcon = isHiddenSection ? 'strikethrough-eye' : 'eye'; // Simplified icon logic
            const eyeTitle = isHiddenSection ? 'Hiện dự án' : 'Ẩn dự án';
            const eyeAction = `event.stopPropagation(); app.toggleProjectVisibility('${safeProjectName.replace(/'/g, "\\'")}')`;
            // Note: toggleProjectVisibility logic handles boolean toggle.

            html += `
                <div class="project-group">
                     <div class="project-header" data-project="${safeProjectName}" onclick="app.toggleProjectExpand('${projectId}-databases', this)">
                        <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
                        <div class="project-label" title="${safeProjectName}">${safeProjectName}${projectCountLabel}</div>
                        
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

