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
            refreshBtn.addEventListener('click', () => {
                this.loadProjectsTree(); // Refresh tree
                this.fetchSelectedDatabases(false); // Refresh data
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
                const url = `${API_BASE}/api/database/${dbId}/raw`;
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
        const { database_name, columns, data, total_records } = result;

        // Check if section already exists
        let section = document.getElementById(`db-section-${dbId}`);
        if (!section) {
            section = document.createElement('div');
            section.id = `db-section-${dbId}`;
            section.className = 'db-section';
            container.appendChild(section);
        }

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
                        <h4 style="margin:0;color:#f1f5f9;font-size:1rem;">${this.escapeHtml(database_name)}</h4>
                        <span style="background:#4ade80;color:#000;padding:4px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;">${total_records} bản ghi</span>
                    </div>
                    
                    <!-- Pagination Controls Top -->
                    <div style="padding:12px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#0f172a;">
                        <div style="display:flex;gap:8px;align-items:center;">
                            <span style="color:#94a3b8;font-size:0.85rem;">Hiển thị:</span>
                            <select id="rawPageSize-${dbId}" style="padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:0.85rem;">
                                <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                                <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                                <option value="200" ${pageSize === 200 ? 'selected' : ''}>200</option>
                                <option value="${data.length}" ${pageSize >= data.length ? 'selected' : ''}>Tất cả</option>
                            </select>
                            <span style="color:#94a3b8;font-size:0.85rem;">dòng</span>
                        </div>
                        <span style="color:#94a3b8;font-size:0.85rem;">Đang hiển thị ${start + 1}-${end} / ${total_records}</span>
                    </div>
                    
                    <div class="report-card-body" style="overflow-x:auto;max-height:600px;overflow-y:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                            <thead style="background:#0f172a;position:sticky;top:0;">
                                <tr>
                                    ${columns.map(col => `<th style="padding:12px 16px;text-align:left;color:#94a3b8;font-weight:500;white-space:nowrap;">${this.escapeHtml(col)}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${pageData.map((row, i) => `
                                    <tr style="border-bottom:1px solid #334155;${i % 2 === 0 ? 'background:#1e293b;' : 'background:#263548;'}">
                                        ${columns.map(col => `<td style="padding:10px 16px;color:#e2e8f0;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.escapeHtml(String(row[col] || ''))}">${this.escapeHtml(String(row[col] || ''))}</td>`).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    <!-- Pagination Controls Bottom -->
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

            // Attach event listeners
            const pageSizeSelect = document.getElementById(`rawPageSize-${dbId}`);
            if (pageSizeSelect) {
                pageSizeSelect.addEventListener('change', (e) => {
                    pageSize = parseInt(e.target.value);
                    currentPage = 1;
                    renderTable();
                });
            }

            const prevBtn = document.getElementById(`rawPrevBtn-${dbId}`);
            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    if (currentPage > 1) {
                        currentPage--;
                        renderTable();
                    }
                });
            }

            const nextBtn = document.getElementById(`rawNextBtn-${dbId}`);
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

            // Visibility Icon
            const eyeIcon = isHiddenSection ? 'strikethrough-eye' : 'eye'; // Simplified icon logic
            const eyeTitle = isHiddenSection ? 'Hiện dự án' : 'Ẩn dự án';
            const eyeAction = `event.stopPropagation(); app.toggleProjectVisibility('${safeProjectName.replace(/'/g, "\\'")}')`;
            // Note: toggleProjectVisibility logic handles boolean toggle.

            html += `
                <div class="project-group">
                     <div class="project-header" data-project="${safeProjectName}" onclick="app.toggleProjectExpand('${projectId}-databases', this)">
                        <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
                        <div class="project-label" title="${safeProjectName}">${safeProjectName}</div>
                        
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
                // Show counts if available, otherwise show placeholder if selectd? 
                // Only show badge if count is defined (loaded)
                const countLabel = (count !== undefined)
                    ? `<span class="db-count-badge">${count}</span>`
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

        // Debounce Fetch
        if (this.fetchDebounce) clearTimeout(this.fetchDebounce);
        this.fetchDebounce = setTimeout(() => {
            this.fetchSelectedDatabases(true /* use cache preference */);
        }, 500);
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

