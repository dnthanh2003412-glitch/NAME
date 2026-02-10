// app.js - Final Dash Notion V3 (Refined)
// Uses window globals from dashboard.js

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

        // Whitelist from backend
        this.whitelistProjects = new Set(); // Project IDs in whitelist
        this.whitelistProjectNames = new Set(); // Project names in whitelist

        this.loadPersistedState();

        this.searchQuery = '';
        this.isHiddenGroupOpen = false; // Mặc định đóng mục "Dự án khác"
        this.isHiddenProjectsOpen = false; // Mặc định đóng mục "Dự án đã ẩn"
        this.isHiddenDatabasesOpen = false; // Mặc định đóng mục "Database đã ẩn"
        this.databaseCounts = {}; // Store record counts
        this.initialFetchDone = false;
    }

    async init() {
        console.log('[Dashboard] Initializing...');

        // Load whitelist first
        await this.loadWhitelist();

        this.setupEventListeners();

        // Initial Load
        await this.loadProjectsTree();

        // Start Polling & Health Check
        this.startPolling();
        this.startHealthCheck();
    }

    // Health check to update connection status
    startHealthCheck() {
        const updateStatus = async () => {
            const statusEl = document.getElementById('connection-status');
            const dotEl = statusEl?.querySelector('.status-dot');
            const textEl = statusEl?.querySelector('.status-text');

            try {
                const response = await fetch(`${API_BASE}/auth/status`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(5000) // 5s timeout
                });
                if (response.ok) {
                    if (dotEl) dotEl.style.background = '#10b981';
                    if (textEl) textEl.textContent = 'Đã kết nối';
                } else {
                    if (dotEl) dotEl.style.background = '#f59e0b';
                    if (textEl) textEl.textContent = 'Hạn chế';
                }
            } catch (e) {
                if (dotEl) dotEl.style.background = '#ef4444';
                if (textEl) textEl.textContent = 'Mất kết nối';
            }
        };

        // Check immediately and then every 30s
        updateStatus();
        setInterval(updateStatus, 30000);
    }

    async loadWhitelist() {
        try {
            const response = await fetch(`${API_BASE}/api/whitelist`);
            const data = await response.json();
            if (data.success && data.projects) {
                this.whitelistProjects.clear();
                this.whitelistProjectNames.clear();
                // Store full whitelist data for direct rendering
                this.whitelistProjectsData = data.projects || [];
                for (const proj of data.projects) {
                    this.whitelistProjects.add(proj.id);
                    this.whitelistProjectNames.add(proj.name);
                }
                console.log(`[Dashboard] Loaded whitelist: ${this.whitelistProjects.size} projects with databases`);
            }
        } catch (error) {
            console.error('[Dashboard] Error loading whitelist:', error);
            this.whitelistProjectsData = [];
        }
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
        // Search with debounce
        const searchInput = document.getElementById('sidebar-search') || document.getElementById('project-search'); // Fallback
        if (searchInput) {
            let searchTimeout = null;
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.trim();
                // Debounce: wait 200ms before rendering to avoid excessive re-renders
                if (searchTimeout) clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.renderProjectsTreeHierarchical();
                }, 200);
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
                        // Refresh the UI - just reload project tree
                        await this.loadProjectsTree();

                        // NOTE: Removed fetchSelectedDatabases - this was causing raw tables to appear
                        // Only regenerate the active report if one exists
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

        // ========== Sidebar Toolbar Buttons ==========

        // Select All Projects (chọn tất cả databases visible)
        const selectAllBtn = document.getElementById('select-all-projects');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                this.selectAllVisibleDatabases();
            });
        }

        // Deselect All Projects (bỏ chọn tất cả)
        const deselectAllBtn = document.getElementById('deselect-all-projects');
        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('click', () => {
                this.deselectAllDatabases();
            });
        }

        // Toggle Hidden Items
        const toggleHiddenBtn = document.getElementById('toggle-hidden-items');
        if (toggleHiddenBtn) {
            toggleHiddenBtn.addEventListener('click', () => {
                this.isHiddenProjectsOpen = !this.isHiddenProjectsOpen;
                toggleHiddenBtn.classList.toggle('active', this.isHiddenProjectsOpen);
                this.renderProjectsTreeHierarchical();
            });
        }

        // Save Sidebar Config
        const saveConfigBtn = document.getElementById('save-sidebar-config');
        if (saveConfigBtn) {
            saveConfigBtn.addEventListener('click', () => {
                this.savePersistedState();
                // Show feedback
                saveConfigBtn.style.background = '#22c55e';
                setTimeout(() => {
                    saveConfigBtn.style.background = '';
                }, 1000);
                console.log('[Dashboard] Sidebar config saved');
            });
        }

        // Reset Sidebar Config
        const resetConfigBtn = document.getElementById('reset-sidebar-config');
        if (resetConfigBtn) {
            resetConfigBtn.addEventListener('click', () => {
                if (confirm('Bạn có chắc muốn đặt lại cấu hình sidebar?')) {
                    this.selectedDatabases.clear();
                    this.hiddenProjects.clear();
                    this.hiddenDatabases.clear();
                    localStorage.removeItem('dashNotion_selectedDatabases');
                    localStorage.removeItem('dashNotion_hiddenProjects');
                    localStorage.removeItem('dashNotion_hiddenDatabases');
                    this.renderProjectsTreeHierarchical();
                    this.updateGenerateButtonState();
                    console.log('[Dashboard] Sidebar config reset');
                }
            });
        }

        // Listen for raw data refresh requests (from raw-table.js)
        document.addEventListener('request-raw-refresh', (e) => {
            const { databaseId } = e.detail;
            if (databaseId) {
                this.refreshSingleDatabase(databaseId);
            }
        });
    }

    // Select all visible databases - ONLY from WHITELIST (filter projectsHierarchy by whitelist IDs)
    selectAllVisibleDatabases() {
        // CLEAR existing selections first
        this.selectedDatabases.clear();

        // Get whitelist IDs set for filtering (match by ID ONLY)
        const whitelistIds = new Set(this.whitelistProjects);
        console.log(`[SelectAll] Whitelist has ${whitelistIds.size} project IDs`);

        let addedCount = 0;
        let matchedProjects = [];

        // Filter projectsHierarchy by whitelist ID
        for (const proj of this.projectsHierarchy) {
            // Only include if ID matches whitelist
            if (!whitelistIds.has(proj.id)) continue;

            // Skip hidden projects
            if (this.hiddenProjects.has(proj.name)) continue;

            matchedProjects.push(proj.name);
            const databases = proj.databases || [];
            for (const db of databases) {
                // Skip hidden databases
                if (this.hiddenDatabases.has(db.id)) continue;

                this.selectedDatabases.add(db.id);
                addedCount++;
            }
        }

        this.savePersistedState();
        this.renderProjectsTreeHierarchical();
        this.updateGenerateButtonState();

        console.log(`[SelectAll] Matched ${matchedProjects.length} projects:`, matchedProjects);
        console.log(`[SelectAll] Selected ${addedCount} databases total`);
    }

    // Deselect all databases
    deselectAllDatabases() {
        const count = this.selectedDatabases.size;
        this.selectedDatabases.clear();
        this.savePersistedState();
        this.renderProjectsTreeHierarchical();
        this.updateGenerateButtonState();
        console.log(`[Dashboard] Deselected all databases: -${count}`);
    }

    updateGenerateButtonState() {
        const generateBtn = document.getElementById('generate-report-btn');
        const reportType = document.getElementById('report-type-select')?.value;
        const hasSelection = this.selectedDatabases.size > 0;

        if (generateBtn) {
            // raw-all doesn't require database selection - it auto-selects whitelist Task DBs
            const isRawAll = reportType === 'raw-all';
            generateBtn.disabled = !(reportType && (hasSelection || isRawAll));

            // Update Selected Count Text
            const countSpan = document.getElementById('selected-count');
            if (countSpan) {
                if (isRawAll) {
                    const { taskDbIds, projectsInfo } = this.getWhitelistTaskDatabases();
                    countSpan.textContent = `🌟 Auto: ${projectsInfo.length} dự án, ${taskDbIds.length} Task DBs`;
                    countSpan.title = projectsInfo.map(p => `${p.name} (${p.taskCount})`).join('\n');
                } else {
                    // Count projects from projectsHierarchy (filter by whitelist ID if needed)
                    const selectedProjectNames = new Set();
                    const whitelistIds = new Set(this.whitelistProjects);

                    for (const dbId of this.selectedDatabases) {
                        for (const proj of this.projectsHierarchy) {
                            if (proj.databases?.some(db => db.id === dbId)) {
                                // Only count if in whitelist (since Select All only selects whitelist)
                                if (whitelistIds.has(proj.id)) {
                                    selectedProjectNames.add(proj.name);
                                } else {
                                    // For "other" projects that user manually selected
                                    selectedProjectNames.add(proj.name);
                                }
                                break;
                            }
                        }
                    }

                    countSpan.textContent = hasSelection ? `Đã chọn ${selectedProjectNames.size} dự án` : 'Chưa chọn dự án';
                    countSpan.title = Array.from(selectedProjectNames).join('\n');
                }
            }
        }
    }

    generateReport() {
        const reportType = document.getElementById('report-type-select')?.value;
        if (!reportType) return;

        const container = document.getElementById('report-container');
        if (!container) return;

        // Generate unique report ID to cancel stale async operations
        this._currentReportId = Date.now();
        const reportId = this._currentReportId;

        // Clear container completely before rendering new report
        container.innerHTML = '';
        console.log(`[Dashboard] Generating report: ${reportType}, reportId: ${reportId}, container cleared`);

        switch (reportType) {
            case 'raw':
                this.renderRawDataReport(container, reportId);
                break;
            case 'raw-all':
                this.renderRawAllProjectsReport(container, reportId);
                break;
            case 'sprint':
                this.renderSprintReport(container); // Placeholder
                break;
            case 'productivity':
                this.renderProductivityReport(container); // Placeholder
                break;
            case 'burndown':
                this.renderBurndownReport(container);
                break;
            default:
                container.innerHTML = '<div class="error-state">Loại báo cáo chưa được hỗ trợ</div>';
        }
    }

    /**
     * Filter selected databases to only include Task databases
     * @returns {Array<string>} Array of Task database IDs only
     */
    getSelectedTaskDatabases() {
        const taskDbIds = [];
        const selectedIds = Array.from(this.selectedDatabases);

        for (const dbId of selectedIds) {
            // Find database info in projectsHierarchy
            for (const project of this.projectsHierarchy) {
                const db = (project.databases || []).find(d => d.id === dbId);
                if (db) {
                    // Check if it's a Task database (by type or name)
                    if (db.type === 'tasks' ||
                        db.name?.toLowerCase().includes('task') ||
                        db.name?.includes('Task')) {
                        taskDbIds.push(dbId);
                    }
                    break;
                }
            }
        }

        console.log(`[Dashboard] Filtered ${selectedIds.length} selected → ${taskDbIds.length} Task databases`);
        return taskDbIds;
    }

    /**
     * Get all Task database IDs from visible whitelist projects
     * @returns {Object} { taskDbIds: Array<string>, projectsInfo: Array<{name, taskCount}> }
     */
    getWhitelistTaskDatabases() {
        const taskDbIds = [];
        const projectsInfo = [];

        // Iterate through projectsHierarchy to find visible whitelist projects with Task databases
        for (const project of this.projectsHierarchy) {
            // Check if project is in whitelist
            const isInWhitelist = this.whitelistProjects.has(project.id) ||
                this.whitelistProjectNames.has(project.name);

            // Skip if not in whitelist or manually hidden
            if (!isInWhitelist) continue;
            if (this.hiddenProjects.has(project.name)) continue;

            // Get Task databases from this project
            const databases = project.databases || [];
            let projectTaskCount = 0;

            for (const db of databases) {
                // Check if database is Task type and not hidden
                if (db.type === 'tasks' && !this.hiddenDatabases.has(db.id)) {
                    taskDbIds.push(db.id);
                    projectTaskCount++;
                }
            }

            // Only add project to info if it has Task databases
            if (projectTaskCount > 0) {
                projectsInfo.push({
                    name: project.name,
                    taskCount: projectTaskCount
                });
            }
        }

        console.log(`[Dashboard] Found ${taskDbIds.length} Task databases from ${projectsInfo.length} whitelist projects`);
        return { taskDbIds, projectsInfo };
    }

    /**
     * Render Raw report for ALL visible whitelist projects (Task databases only)
     */
    async renderRawAllProjectsReport(container, reportId) {
        // Show loading state
        container.innerHTML = '<div class="loading-state" style="padding:40px;text-align:center;color:#64748b;">Đang tải dữ liệu Task từ các dự án whitelist...</div>';

        // Get all Task databases from visible whitelist projects
        const { taskDbIds, projectsInfo } = this.getWhitelistTaskDatabases();

        if (taskDbIds.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Không tìm thấy database Task nào trong các dự án whitelist đang hiển thị.<br><br>Hãy mở thêm dự án từ "Dự án khác" hoặc "Dự án đã ẩn" rồi bấm Tạo Báo Cáo lại.</div>';
            return;
        }

        // Build project list HTML
        const projectListHtml = projectsInfo.map(p =>
            `<span style="background:#3b82f620;padding:2px 8px;border-radius:4px;margin:2px;display:inline-block;font-size:0.75rem;">${p.name} (${p.taskCount})</span>`
        ).join('');

        // Show info about which databases will be loaded
        const loadingInfo = document.createElement('div');
        loadingInfo.className = 'loading-info';
        loadingInfo.style.cssText = 'padding:12px 20px;background:#1e3a5f;border-radius:8px;margin-bottom:16px;';
        loadingInfo.innerHTML = `
            <div style="color:#94a3b8;font-size:0.85rem;">
                🌟 <strong>Raw All Projects (Whitelist)</strong> - ${projectsInfo.length} dự án, ${taskDbIds.length} Task DBs<br>
                <div style="margin-top:8px;line-height:1.8;">${projectListHtml}</div>
                <div style="margin-top:8px;color:#60a5fa;">⏳ Đang tải dữ liệu...</div>
            </div>
        `;
        container.innerHTML = '';
        container.appendChild(loadingInfo);

        try {
            // Fetch in PARALLEL (batches of 5 to avoid overwhelming server)
            const allData = [];
            const allColumns = new Set();
            const BATCH_SIZE = 5;
            let loadedCount = 0;

            // Progress update function
            const updateProgress = () => {
                // Check if report is still current
                if (reportId && this._currentReportId !== reportId) return;

                const progressDiv = loadingInfo.querySelector('.progress-text');
                if (progressDiv) {
                    progressDiv.textContent = `⏳ Đang tải... ${loadedCount}/${taskDbIds.length} databases`;
                }
            };

            // Add progress element
            loadingInfo.querySelector('div').innerHTML += `
                <div class="progress-text" style="margin-top:8px;color:#60a5fa;">⏳ Đang tải... 0/${taskDbIds.length} databases</div>
            `;

            // Process in batches
            for (let i = 0; i < taskDbIds.length; i += BATCH_SIZE) {
                // Check if report is still current before each batch
                if (reportId && this._currentReportId !== reportId) {
                    console.log(`[Dashboard] Raw-All report ${reportId} cancelled`);
                    return;
                }

                const batch = taskDbIds.slice(i, i + BATCH_SIZE);

                // Fetch batch in parallel
                const results = await Promise.all(
                    batch.map(async (dbId) => {
                        try {
                            const url = `${API_BASE}/api/database/${dbId}/raw?_t=${Date.now()}`;
                            const response = await fetch(url);
                            return await response.json();
                        } catch (e) {
                            console.error(`Error fetching ${dbId}:`, e);
                            return { success: false };
                        }
                    })
                );

                // Process results
                results.forEach(result => {
                    loadedCount++;
                    if (result.success && result.data && result.data.length > 0) {
                        const enrichedData = result.data.map(row => ({
                            ...row,
                            _source_db: result.database_name || 'Unknown'
                        }));
                        allData.push(...enrichedData);

                        if (result.columns) {
                            result.columns.forEach(col => allColumns.add(col));
                        }
                    }
                });

                updateProgress();
            }

            // Update loading info
            loadingInfo.querySelector('div').innerHTML = `
                🌟 <strong>Raw All Projects (Whitelist)</strong> - ${projectsInfo.length} dự án, ${taskDbIds.length} Task DBs<br>
                <div style="margin-top:8px;line-height:1.8;">${projectListHtml}</div>
                <div style="margin-top:8px;color:#22c55e;">✅ Đã tải ${allData.length} records</div>
            `;

            // Final check if report is still current
            if (reportId && this._currentReportId !== reportId) {
                console.log(`[Dashboard] Raw-All report ${reportId} cancelled before render`);
                return;
            }

            if (allData.length === 0) {
                container.innerHTML += '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Không có dữ liệu Task nào trong các dự án whitelist.</div>';
                return;
            }

            // Add _source_db to columns if not present
            allColumns.add('_source_db');

            // Render ONE combined table with all merged data
            const combinedResult = {
                database_name: `All Whitelist Tasks (${projectsInfo.length} dự án)`,
                columns: Array.from(allColumns),
                data: allData,
                total_records: allData.length
            };

            this.renderRawDatabaseTable(container, 'all-whitelist-tasks', combinedResult);

        } catch (err) {
            console.error('Error fetching raw all data:', err);
            container.innerHTML = `<div class="error-state" style="padding:40px;text-align:center;color:#ef4444;">Lỗi: ${err.message}</div>`;
        }
    }

    /**
     * Burndown view mode: 'sprint' or 'project'
     */
    burndownViewMode = 'sprint';

    /**
     * Render Burndown Chart Report
     * Shows burndown charts for each selected Task database that has Sprint and "Ngày Làm" columns
     * Supports two view modes: by Sprint or by Project
     */
    async renderBurndownReport(container) {
        container.innerHTML = '<div class="loading-state" style="padding:40px;text-align:center;color:#64748b;">Đang tải dữ liệu Burndown...</div>';

        // Only use Task databases for Burndown
        const dbIds = this.getSelectedTaskDatabases();
        if (dbIds.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Không có database Task nào được chọn.<br><span style="font-size:0.85rem;">Burndown Chart chỉ áp dụng cho database Task.</span></div>';
            return;
        }

        try {
            let hasValidChart = false;
            const warnings = [];

            // Clear loading and add view mode selector
            container.innerHTML = '';

            console.log('[Burndown] NEW CODE v10 - Adding view mode toggle, current mode:', this.burndownViewMode);

            // Add view mode toggle at the top
            const viewModeSection = document.createElement('div');
            viewModeSection.className = 'burndown-view-mode-section';
            viewModeSection.style.cssText = 'margin-bottom:20px;padding:16px;background:#1e293b;border-radius:12px;border:1px solid #334155;display:flex;align-items:center;gap:16px;';
            viewModeSection.innerHTML = `
                <span style="color:#94a3b8;font-size:0.9rem;font-weight:500;">📊 Chế độ xem:</span>
                <div style="display:flex;gap:8px;">
                    <button id="burndown-view-sprint" class="burndown-view-btn ${this.burndownViewMode === 'sprint' ? 'active' : ''}" 
                            style="padding:8px 16px;border-radius:8px;border:1px solid ${this.burndownViewMode === 'sprint' ? '#3b82f6' : '#475569'};
                                   background:${this.burndownViewMode === 'sprint' ? '#3b82f620' : 'transparent'};
                                   color:${this.burndownViewMode === 'sprint' ? '#60a5fa' : '#94a3b8'};
                                   cursor:pointer;font-size:0.85rem;font-weight:500;transition:all 0.2s;">
                        🏃 Theo Sprint
                    </button>
                    <button id="burndown-view-project" class="burndown-view-btn ${this.burndownViewMode === 'project' ? 'active' : ''}"
                            style="padding:8px 16px;border-radius:8px;border:1px solid ${this.burndownViewMode === 'project' ? '#3b82f6' : '#475569'};
                                   background:${this.burndownViewMode === 'project' ? '#3b82f620' : 'transparent'};
                                   color:${this.burndownViewMode === 'project' ? '#60a5fa' : '#94a3b8'};
                                   cursor:pointer;font-size:0.85rem;font-weight:500;transition:all 0.2s;">
                        📁 Theo Dự án
                    </button>
                </div>
                <span style="color:#64748b;font-size:0.75rem;margin-left:auto;">
                    ${this.burndownViewMode === 'sprint' ? 'Mỗi Sprint sẽ hiển thị một biểu đồ riêng' : 'Gộp tất cả task của dự án thành một biểu đồ'}
                </span>
            `;
            container.appendChild(viewModeSection);

            // Attach click handlers for view mode buttons
            const sprintBtn = viewModeSection.querySelector('#burndown-view-sprint');
            const projectBtn = viewModeSection.querySelector('#burndown-view-project');

            sprintBtn.addEventListener('click', () => {
                if (this.burndownViewMode !== 'sprint') {
                    this.burndownViewMode = 'sprint';
                    this.renderBurndownReport(container);
                }
            });

            projectBtn.addEventListener('click', () => {
                if (this.burndownViewMode !== 'project') {
                    this.burndownViewMode = 'project';
                    this.renderBurndownReport(container);
                }
            });

            for (const dbId of dbIds) {
                const url = `${API_BASE}/api/database/${dbId}/raw?_t=${Date.now()}`;
                const response = await fetch(url);
                const result = await response.json();

                if (!result.success) {
                    warnings.push({ dbName: dbId, reason: 'Không thể tải dữ liệu' });
                    continue;
                }

                const { database_name, columns, data } = result;

                // Check if database has required columns
                const findColumn = (...names) => {
                    return columns.find(c =>
                        names.some(n => c.toLowerCase().includes(n.toLowerCase()))
                    );
                };

                // Find exact column (case-insensitive exact match)
                const findExactColumn = (...names) => {
                    return columns.find(c =>
                        names.some(n => c.toLowerCase() === n.toLowerCase())
                    );
                };

                const sprintCol = findColumn('Sprint');
                // Prioritize "Ngày Làm" (the date column used for burndown)
                const dateCol = findExactColumn('Ngày Làm', 'Ngay Lam') ||
                    findColumn('Ngày Làm', 'Ngay Lam');
                const statusCol = findExactColumn('Task Status') || findColumn('Task Status', 'Status');
                const pointCol = findColumn('Product Point', 'Point', 'Story Point', 'Points');

                console.log(`[Burndown] ${database_name} - Columns found:`, { sprintCol, dateCol, statusCol, pointCol });

                // Validation - Sprint column only required for Sprint view mode
                if (this.burndownViewMode === 'sprint' && !sprintCol) {
                    warnings.push({ dbName: database_name, reason: 'Không có cột Sprint' });
                    continue;
                }
                if (!dateCol) {
                    warnings.push({ dbName: database_name, reason: 'Không có cột Ngày Làm / Done Date' });
                    continue;
                }

                // Handle different view modes
                if (this.burndownViewMode === 'project') {
                    // PROJECT VIEW: All tasks as a single burndown
                    hasValidChart = this.renderProjectBurndown(container, dbId, database_name, data, {
                        dateCol, statusCol, pointCol
                    }) || hasValidChart;
                } else {
                    // SPRINT VIEW: Group by Sprint (existing logic)
                    // Group tasks by Sprint
                    const sprintGroups = new Map();
                    data.forEach(task => {
                        const sprintValue = task[sprintCol];
                        if (!sprintValue || sprintValue === '-') return;

                        if (!sprintGroups.has(sprintValue)) {
                            sprintGroups.set(sprintValue, []);
                        }
                        sprintGroups.get(sprintValue).push(task);
                    });

                    if (sprintGroups.size === 0) {
                        warnings.push({ dbName: database_name, reason: 'Không có dữ liệu Sprint' });
                        continue;
                    }

                    // Create section for this database
                    const dbSection = document.createElement('div');
                    dbSection.className = 'burndown-db-section';
                    dbSection.style.cssText = 'margin-bottom:24px;';

                    dbSection.innerHTML = `
                        <div style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
                            <div style="padding:16px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">
                                <h3 style="margin:0;color:#f1f5f9;font-size:1.1rem;">📊 ${this.escapeHtml(database_name)}</h3>
                                <span style="color:#94a3b8;font-size:0.8rem;">${sprintGroups.size} Sprint(s) | ${data.length} tasks</span>
                            </div>
                            <div id="burndown-charts-${dbId}" style="padding:16px;"></div>
                        </div>
                    `;
                    container.appendChild(dbSection);

                    const chartsContainer = dbSection.querySelector(`#burndown-charts-${dbId}`);

                    // Fetch Sprint metadata (dates) - need to find Sprints database
                    // For now, estimate sprint dates from task dates
                    for (const [sprintName, tasks] of sprintGroups) {
                        // Estimate sprint date range from ALL tasks with dates
                        let minDate = null, maxDate = null;
                        let doneTasksWithDates = 0;

                        tasks.forEach(task => {
                            // Try to get date from Done Date column
                            let dateValue = task[dateCol];
                            let taskDate = null;

                            if (dateValue) {
                                if (typeof dateValue === 'object' && dateValue.start) {
                                    taskDate = new Date(dateValue.start);
                                } else if (typeof dateValue === 'object' && dateValue.end) {
                                    taskDate = new Date(dateValue.end);
                                } else if (typeof dateValue === 'string') {
                                    // Handle date range strings
                                    if (dateValue.includes('→')) {
                                        const parts = dateValue.split('→');
                                        taskDate = new Date(parts[0].trim());
                                    } else {
                                        taskDate = new Date(dateValue);
                                    }
                                }
                            }

                            // Also check if task is Done to count
                            const status = task[statusCol];
                            const isDone = status && (
                                status.toLowerCase().includes('done') ||
                                status.toLowerCase().includes('complete')
                            );
                            if (isDone && taskDate && !isNaN(taskDate.getTime())) {
                                doneTasksWithDates++;
                            }

                            if (taskDate && !isNaN(taskDate.getTime())) {
                                if (!minDate || taskDate < minDate) minDate = taskDate;
                                if (!maxDate || taskDate > maxDate) maxDate = taskDate;
                            }
                        });

                        console.log(`[Burndown] Sprint "${sprintName}": ${tasks.length} tasks, ${doneTasksWithDates} done with dates, date range: ${minDate?.toISOString().split('T')[0]} - ${maxDate?.toISOString().split('T')[0]}`);

                        // If no dates found, skip this sprint
                        if (!minDate || !maxDate) {
                            const skipMsg = document.createElement('div');
                            skipMsg.style.cssText = 'padding:12px;margin:8px 0;background:#1e3a5f;border-radius:8px;color:#f59e0b;font-size:0.85rem;';
                            skipMsg.innerHTML = `⚠️ Sprint "<strong>${this.escapeHtml(sprintName)}</strong>" - Không có dữ liệu ngày để tạo Burndown`;
                            chartsContainer.appendChild(skipMsg);
                            continue;
                        }

                        // Add some padding to date range
                        minDate.setDate(minDate.getDate() - 1);
                        maxDate.setDate(maxDate.getDate() + 1);

                        // Create container for this sprint's chart
                        const chartContainerId = `burndown-${dbId}-${this.hashString(sprintName)}`;
                        const chartWrapper = document.createElement('div');
                        chartWrapper.id = chartContainerId;
                        chartWrapper.style.cssText = 'background:#0f172a;border-radius:8px;margin-bottom:16px;border:1px solid #334155;';
                        chartsContainer.appendChild(chartWrapper);

                        // Render burndown chart
                        if (typeof window.renderBurndownChart === 'function') {
                            window.renderBurndownChart(
                                chartContainerId,
                                {
                                    name: sprintName,
                                    startDate: minDate.toISOString(),
                                    endDate: maxDate.toISOString()
                                },
                                tasks,
                                {
                                    pointField: pointCol || 'Product Point',
                                    dateField: dateCol,
                                    statusField: statusCol || 'Task Status'
                                }
                            );
                            hasValidChart = true;
                        }
                    }
                } // End of Sprint view block
            } // End of database loop

            // Show warnings if any
            if (warnings.length > 0) {
                const warningSection = document.createElement('div');
                warningSection.style.cssText = 'background:#422006;border:1px solid #854d0e;border-radius:8px;padding:16px;margin-bottom:20px;';
                warningSection.innerHTML = `
                    <h4 style="margin:0 0 12px 0;color:#fbbf24;font-size:0.9rem;">⚠️ Cảnh báo - Một số database không hỗ trợ Burndown</h4>
                    <ul style="margin:0;padding-left:20px;color:#fde68a;font-size:0.85rem;">
                        ${warnings.map(w => `<li><strong>${this.escapeHtml(w.dbName)}</strong>: ${w.reason}</li>`).join('')}
                    </ul>
                    <p style="margin:12px 0 0 0;color:#d97706;font-size:0.8rem;">
                        💡 Để hiển thị Burndown, database cần có cột <strong>${this.burndownViewMode === 'sprint' ? 'Sprint và ' : ''}</strong><strong>Ngày Làm</strong> (hoặc Done Date)
                    </p>
                `;
                container.insertBefore(warningSection, viewModeSection.nextSibling);
            }

            // If no valid charts were rendered
            if (!hasValidChart && warnings.length === dbIds.length) {
                const errorContent = document.createElement('div');
                errorContent.style.cssText = 'padding:60px 40px;text-align:center;';
                errorContent.innerHTML = `
                    <div style="font-size:3rem;margin-bottom:16px;">📉</div>
                    <h3 style="color:#f1f5f9;margin:0 0 12px 0;">Không thể tạo Burndown Chart</h3>
                    <p style="color:#94a3b8;margin:0 0 20px 0;">Các database đã chọn không có đủ dữ liệu cần thiết.</p>
                    <div style="background:#1e293b;border-radius:8px;padding:20px;display:inline-block;text-align:left;">
                        <p style="color:#60a5fa;margin:0 0 8px 0;font-weight:600;">Yêu cầu dữ liệu:</p>
                        <ul style="color:#94a3b8;margin:0;padding-left:20px;">
                            ${this.burndownViewMode === 'sprint' ? '<li>Cột <strong>Sprint</strong> - để xác định sprint</li>' : ''}
                            <li>Cột <strong>Ngày Làm</strong> hoặc <strong>Done Date</strong> - để tính ngày hoàn thành</li>
                            <li>Cột <strong>Task Status</strong> - để biết task đã Done chưa</li>
                        </ul>
                    </div>
                `;
                container.appendChild(errorContent);
            }

        } catch (err) {
            console.error('Error rendering burndown:', err);
            container.innerHTML = `<div class="error-state" style="padding:40px;text-align:center;color:#ef4444;">Lỗi: ${err.message}</div>`;
        }
    }

    /**
     * Render a project-level burndown chart (all tasks from a single database)
     * @param {HTMLElement} container - The container element
     * @param {string} dbId - Database ID
     * @param {string} dbName - Database name
     * @param {Array} data - All tasks from the database
     * @param {Object} columns - { dateCol, statusCol, pointCol }
     * @returns {boolean} True if chart was rendered successfully
     */
    renderProjectBurndown(container, dbId, dbName, data, { dateCol, statusCol, pointCol }) {
        // Estimate date range from ALL tasks with dates
        let minDate = null, maxDate = null;
        let tasksWithDates = 0;

        data.forEach(task => {
            let dateValue = task[dateCol];
            let taskDate = null;

            if (dateValue) {
                if (typeof dateValue === 'object' && dateValue.start) {
                    taskDate = new Date(dateValue.start);
                } else if (typeof dateValue === 'object' && dateValue.end) {
                    taskDate = new Date(dateValue.end);
                } else if (typeof dateValue === 'string') {
                    if (dateValue.includes('→')) {
                        const parts = dateValue.split('→');
                        taskDate = new Date(parts[0].trim());
                    } else {
                        taskDate = new Date(dateValue);
                    }
                }
            }

            if (taskDate && !isNaN(taskDate.getTime())) {
                tasksWithDates++;
                if (!minDate || taskDate < minDate) minDate = taskDate;
                if (!maxDate || taskDate > maxDate) maxDate = taskDate;
            }
        });

        console.log(`[Burndown Project] ${dbName}: ${data.length} tasks, ${tasksWithDates} with dates, range: ${minDate?.toISOString().split('T')[0]} - ${maxDate?.toISOString().split('T')[0]}`);

        // If no dates found, show message
        if (!minDate || !maxDate) {
            const skipMsg = document.createElement('div');
            skipMsg.style.cssText = 'padding:20px;margin:8px 0;background:#1e3a5f;border-radius:12px;color:#f59e0b;';
            skipMsg.innerHTML = `⚠️ <strong>${this.escapeHtml(dbName)}</strong> - Không có dữ liệu ngày để tạo Burndown`;
            container.appendChild(skipMsg);
            return false;
        }

        // Add padding to date range
        minDate.setDate(minDate.getDate() - 1);
        maxDate.setDate(maxDate.getDate() + 1);

        // Create section for this project
        const dbSection = document.createElement('div');
        dbSection.className = 'burndown-db-section';
        dbSection.style.cssText = 'margin-bottom:24px;';

        const chartContainerId = `burndown-project-${dbId}`;
        dbSection.innerHTML = `
            <div style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
                <div style="padding:16px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;color:#f1f5f9;font-size:1.1rem;">📁 ${this.escapeHtml(dbName)}</h3>
                    <span style="color:#94a3b8;font-size:0.8rem;">${data.length} tasks tổng | ${tasksWithDates} có ngày</span>
                </div>
                <div id="${chartContainerId}" style="padding:16px;background:#0f172a;"></div>
            </div>
        `;
        container.appendChild(dbSection);

        // Render burndown chart
        if (typeof window.renderBurndownChart === 'function') {
            window.renderBurndownChart(
                chartContainerId,
                {
                    name: `Dự án: ${dbName}`,
                    startDate: minDate.toISOString(),
                    endDate: maxDate.toISOString()
                },
                data,
                {
                    pointField: pointCol || 'Product Point',
                    dateField: dateCol,
                    statusField: statusCol || 'Task Status'
                }
            );
            return true;
        }
        return false;
    }

    /**
     * Force refresh a single database's raw data
     * @param {string} dbId - Database ID
     */
    async refreshSingleDatabase(dbId) {
        console.log(`[Dashboard] Force refreshing database ${dbId}...`);

        const section = document.getElementById(`db-section-${dbId}`);
        const container = document.getElementById('report-container');

        if (section) {
            // Show loading in the table area
            const tableArea = section.querySelector(`#table-area-${dbId}`);
            if (tableArea) {
                tableArea.innerHTML = '<div class="loading-state" style="padding:40px;text-align:center;color:#64748b;">Đang tải lại dữ liệu từ Notion (Force Refresh)...</div>';
            }

            // Also update dashboard area to indicate loading
            const dashboardArea = section.querySelector(`#dashboard-area-${dbId}`);
            if (dashboardArea) {
                dashboardArea.innerHTML = '';
            }
        }

        try {
            // Force refresh with parameter
            const url = `${API_BASE}/api/database/${dbId}/raw?refresh=true&_t=${Date.now()}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                console.log(`[Dashboard] Refreshed ${dbId} successfully.`);
                // Re-render the specific table
                this.renderRawDatabaseTable(container, dbId, result);

                // Show success toast/notification if possible, or just console log
            } else {
                console.error(`[Dashboard] Failed to refresh ${dbId}:`, result.error);
                if (section) {
                    const tableArea = section.querySelector(`#table-area-${dbId}`);
                    if (tableArea) {
                        tableArea.innerHTML = `<div class="error-msg" style="color:#ef4444;padding:20px;text-align:center;background:#1e293b;border-radius:8px;">❌ Lỗi khi làm mới: ${result.error}</div>`;
                    }
                }
            }
        } catch (err) {
            console.error(`[Dashboard] Error refreshing ${dbId}:`, err);
            if (section) {
                const tableArea = section.querySelector(`#table-area-${dbId}`);
                if (tableArea) {
                    tableArea.innerHTML = `<div class="error-msg" style="color:#ef4444;padding:20px;text-align:center;background:#1e293b;border-radius:8px;">❌ Lỗi kết nối: ${err.message}</div>`;
                }
            }
        }
    }

    async renderRawDataReport(container, reportId) {
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
                // Check if this report is still current (user may have switched)
                if (reportId && this._currentReportId !== reportId) {
                    console.log(`[Dashboard] Report ${reportId} cancelled, current is ${this._currentReportId}`);
                    return;
                }

                // Use the raw API endpoint which returns flattened data with all Notion columns
                const url = `${API_BASE}/api/database/${dbId}/raw?_t=${Date.now()}`;
                const response = await fetch(url);
                const result = await response.json();

                // Check again after async fetch
                if (reportId && this._currentReportId !== reportId) {
                    console.log(`[Dashboard] Report ${reportId} cancelled after fetch`);
                    return;
                }

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

    /**
     * Columns to hide/merge (duplicate or unnecessary)
     * These will be auto-hidden from display
     */
    static COLUMNS_TO_HIDE = new Set([
        'run n8n', 'p type', 'blocking', '[dev] total main', 'product status',
        'block by', 'description', 'loai canh', 'utkt', 'tp giả định 2',
        'task 2', 'task fix', 'task qc', 'loại cảnh', 'rollup',
        'point status (1)', 'crea', 'blocked by',
        // Additional columns to hide
        'product type', 'p type',  // Keep only PRODUCT TYPE
        'product (1)', 'phân loại', '[harry] product',
        'last edit time', 'lastedittime', 'last edited',  // Hide unless has data
        'create time', 'createtime', 'created time'  // Hide unless has data
    ].map(c => c.toLowerCase()));

    /**
     * Columns that should only show if they have actual data
     */
    static COLUMNS_SHOW_IF_HAS_DATA = new Set([
        'last edit time', 'lastedittime', 'last edited', 'lastEditTime',
        'create time', 'createtime', 'created time', 'createTime'
    ].map(c => c.toLowerCase()));

    /**
     * Check if column should be hidden
     */
    shouldHideColumn(colName, data = []) {
        const lowerCol = colName.toLowerCase();

        // Check if it's a "show if has data" column
        if (DashboardApp.COLUMNS_SHOW_IF_HAS_DATA.has(lowerCol)) {
            // Check if any row has actual data in this column
            const hasData = data.some(row => {
                const val = row[colName];
                return val && val !== '-' && val !== '' && val !== null && val !== undefined;
            });
            return !hasData; // Hide if NO data
        }

        return DashboardApp.COLUMNS_TO_HIDE.has(lowerCol);
    }

    renderRawDatabaseTable(container, dbId, result) {
        let { database_name, columns: rawColumns, data: originalData, total_records } = result;

        // Filter out hidden/duplicate columns (pass data to check "show if has data" columns)
        const originalColumns = rawColumns.filter(col => !this.shouldHideColumn(col, originalData));

        console.log(`[Frontend] Render table for ${dbId}:`, {
            name: database_name,
            total_records_api: total_records,
            data_length: originalData.length,
            columns_before_filter: rawColumns.length,
            columns_after_filter: originalColumns.length,
            hidden_columns: rawColumns.filter(c => this.shouldHideColumn(c, originalData)),
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

        // Structure: Separate Dashboard and Table areas
        if (!section.querySelector(`#dashboard-area-${dbId}`)) {
            section.innerHTML = `
                <div id="dashboard-area-${dbId}"></div>
                <div id="table-area-${dbId}"></div>
            `;
        }
        const dashboardArea = section.querySelector(`#dashboard-area-${dbId}`);
        const tableArea = section.querySelector(`#table-area-${dbId}`);

        // Dashboard render function - defined here to access table state
        const updateDashboard = (data, options = {}) => {
            if (typeof window.renderRawDataDashboard === 'function' && data.length > 0) {
                // Clear old dashboard before re-rendering
                dashboardArea.innerHTML = '';
                window.renderRawDataDashboard(data, dashboardArea, database_name, options);
            }
        };

        // Handler for Dashboard Filter Changes (Sync Dashboard -> Table)
        const handleDashboardFilterChange = ({ startDate, endDate, activePreset }) => {
            console.log('[App] Dashboard filter changed:', { startDate, endDate });

            // Update local filter state
            startDateFilter = startDate;
            endDateFilter = endDate;

            // Update custom date inputs if they exist (though dashboard uses its own)
            // We just need to ensure applyFiltersAndSearch uses the new values.

            // Re-apply filters to table
            applyFiltersAndSearch();
            renderTable();
        };

        // Initial Dashboard render with all data AND sync callback
        if (typeof window.renderRawDataDashboard === 'function' && originalData.length > 0) {
            if (dashboardArea.childNodes.length === 0) {
                window.renderRawDataDashboard(originalData, dashboardArea, database_name, {
                    onFilterChange: handleDashboardFilterChange
                });
            }
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
        let pageSize = 10;
        let showColumnPicker = false;

        // Assignee filter setup
        // Normalize string for Vietnamese comparison
        const normalizeStr = (str) => {
            return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        };

        const findCol = (...names) => {
            // Iterate names (priority list) first!
            for (const name of names) {
                const normName = normalizeStr(name);

                // 1. Exact match
                let found = originalColumns.find(c => c.toLowerCase() === name.toLowerCase());
                if (found) return found;

                // 2. Normalized match (ignore accents)
                found = originalColumns.find(c => normalizeStr(c) === normName);
                if (found) return found;
            }

            // 3. Partial match (Low priority)
            for (const name of names) {
                const found = originalColumns.find(c => c.toLowerCase().includes(name.toLowerCase()));
                if (found) return found;
            }
            return undefined;
        };
        const assigneeCol = findCol('ASSIGNEE', 'Người thực hiện', 'Assignee', 'Người làm', 'OWNER', 'Owner');
        // Prioritize "NGÀY LÀM" as requested
        const dateCol = findCol('NGÀY LÀM', 'Ngày làm', 'Work Date', 'DoneDate', 'Done Date', 'DONE DATE', 'DONE', 'Date');
        console.log('[RawTable] findCol dateCol result:', dateCol);
        const sprintCol = findCol('Sprint', 'SPRINT');
        const assignees = assigneeCol ? [...new Set(originalData.map(r => r[assigneeCol]).filter(v => v && v !== '-' && v !== ''))].sort() : [];
        const sprints = sprintCol ? [...new Set(originalData.map(r => r[sprintCol]).filter(v => v && v !== '-' && v !== ''))].sort() : [];

        // Extract available months/years from date column
        const extractMonthsYears = () => {
            if (!dateCol) return { months: [], years: [] };
            const yearsSet = new Set();
            originalData.forEach(row => {
                const dateStr = row[dateCol];
                if (!dateStr) return;
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) {
                    yearsSet.add(d.getFullYear());
                }
            });
            return { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], years: [...yearsSet].sort((a, b) => b - a) };
        };
        const { months, years } = extractMonthsYears();

        let assigneeTableFilter = '';
        let startDateFilter = '';
        let endDateFilter = '';
        let sprintTableFilter = '';

        // Find fallback date column (LastEditTime, Created)
        const fallbackDateCol = originalColumns.find(c =>
            c.toLowerCase().includes('lastedittime') ||
            c.toLowerCase().includes('last edit') ||
            c.toLowerCase().includes('updated') ||
            c.toLowerCase().includes('created')
        ) || '';

        // Get visible columns
        const getVisibleColumns = () => columnOrder.filter(col => !hiddenColumns.has(col));

        // Parse date helper (supports multiple formats including arrow ranges)
        const parseDate = (val) => {
            if (!val) return null;
            if (val instanceof Date && !isNaN(val)) return val;
            let str = String(val).trim();

            // Handle arrow format: "2025-01-08 → 2025-01-09" - extract first date
            if (str.includes('→')) {
                str = str.split('→')[0].trim();
            }

            // Try DD/MM/YYYY
            const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (dmy) return new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));

            // Try YYYY-MM-DD or other ISO formats
            const d = new Date(str);
            return isNaN(d.getTime()) ? null : d;
        };

        // Apply search and sort
        const applyFiltersAndSearch = () => {
            filteredData = originalData.filter(row => {
                // Assignee Filter
                if (assigneeTableFilter && assigneeCol) {
                    if (row[assigneeCol] !== assigneeTableFilter) return false;
                }

                // Sprint Filter
                if (sprintTableFilter && sprintCol) {
                    if (row[sprintCol] !== sprintTableFilter) return false;
                }

                // Date Range Filter (with fallback)
                if (dateCol && (startDateFilter || endDateFilter)) {
                    // Try primary date column first
                    let dateStr = row[dateCol];
                    let d = parseDate(dateStr);

                    // Fallback logic MOVED: Only use fallback info if dateCol was NOT found globally.
                    // If dateCol exists (e.g. NGÀY LÀM), we MUST use it. 
                    // If row has empty NGÀY LÀM, it effectively has NO date.

                    // STRICT FILTER: If filtering by date, tasks MUST have a valid date
                    if (!d) return false;

                    if (startDateFilter) {
                        const start = new Date(startDateFilter);
                        if (d < start) return false;
                    }
                    if (endDateFilter) {
                        const end = new Date(endDateFilter);
                        end.setHours(23, 59, 59, 999);
                        if (d > end) return false;
                    }
                }

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

            // Update dashboard with filtered data (sync table filters → dashboard)
            updateDashboard(filteredData, {
                startDate: startDateFilter,
                endDate: endDateFilter,
                assigneeFilter: assigneeTableFilter,
                sprintFilter: sprintTableFilter
            });
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
            // Generate export filename
            const today = new Date();
            const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            let exportFileName;
            if (dbId === 'all-whitelist-tasks') {
                // Multi-project raw-all report
                exportFileName = `BaoCao_All_Whitelist_Tasks_${dateStr}.xls`;
            } else {
                // Single database export - use database name + date
                exportFileName = `${database_name.replace(/[^a-z0-9]/gi, '_')}_${dateStr}.xls`;
            }
            a.download = exportFileName;
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
                    #table-${dbId} { border-collapse: separate; border-spacing: 0; }
                    #table-${dbId} th, #table-${dbId} td { border: 1px solid #475569; }
                    #table-${dbId} th { cursor: grab; user-select: none; min-width: 120px; }
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
                    .table-scroll-container-${dbId} {
                        overflow-x: auto;
                        overflow-y: auto;
                        max-height: 600px;
                        scrollbar-width: thin;
                        scrollbar-color: #475569 #1e293b;
                    }
                    .table-scroll-container-${dbId}::-webkit-scrollbar { height: 10px; width: 10px; }
                    .table-scroll-container-${dbId}::-webkit-scrollbar-track { background: #1e293b; border-radius: 5px; }
                    .table-scroll-container-${dbId}::-webkit-scrollbar-thumb { background: #475569; border-radius: 5px; }
                    .table-scroll-container-${dbId}::-webkit-scrollbar-thumb:hover { background: #64748b; }
                    .scroll-hint-${dbId} { 
                        display: flex; align-items: center; gap: 6px; 
                        padding: 6px 12px; background: rgba(59, 130, 246, 0.1); 
                        border-radius: 4px; font-size: 0.75rem; color: #94a3b8;
                        margin-bottom: 8px;
                    }
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
                        <div style="display:flex;gap:8px;align-items:center;flex:1;max-width:600px;">
                            <div style="display:flex;align-items:center;background:#1e293b;border:1px solid #475569;border-radius:4px;padding:0 8px;flex:1;">
                                <span style="color:#94a3b8;font-size:0.85rem;">🔍</span>
                                <input type="text" id="searchInput-${dbId}" placeholder="Tìm kiếm..." 
                                    value="${searchQuery}"
                                    style="border:none;background:transparent;color:#e2e8f0;padding:6px;width:100%;outline:none;">
                                ${searchQuery ? `<button id="clearSearch-${dbId}" style="padding:4px 8px;background:none;border:none;color:#94a3b8;cursor:pointer;">✕</button>` : ''}
                            </div>
                            
                            ${assignees.length > 0 ? `
                                <select id="assigneeFilter-${dbId}" style="padding:6px 12px;background:#1e293b;border:1px solid #475569;border-radius:4px;color:#e2e8f0;font-size:0.85rem;max-width:150px;text-overflow:ellipsis;">
                                    <option value="">Tất cả nhân sự</option>
                                    ${assignees.map(a => `<option value="${a}" ${assigneeTableFilter === a ? 'selected' : ''}>${a}</option>`).join('')}
                                </select>
                            ` : ''}
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
                                <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                                <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                                <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                                <option value="${originalData.length}" ${pageSize >= originalData.length ? 'selected' : ''}>Tất cả</option>
                            </select>
                            <span style="color:#94a3b8;font-size:0.8rem;">${start + 1}-${end}/${filteredData.length}</span>
                        </div>
                    </div>
                    
                    <!-- Scroll Hint -->
                    <div class="scroll-hint-${dbId}" style="margin:8px 20px;">
                        <span>🖱️</span>
                        <span>Shift + Lăn chuột để cuộn ngang | Kéo thả để sắp xếp cột</span>
                    </div>
                    
                    <div class="table-scroll-container-${dbId}" id="tableScrollContainer-${dbId}" style="margin:0 20px 20px;">
                        <table id="table-${dbId}" style="width:max-content;min-width:100%;border-collapse:collapse;font-size:0.85rem;">
                            <thead style="background:#0f172a;position:sticky;top:0;z-index:10;">
                                <tr>
                                    ${visibleCols.map((col, idx) => `
                                        <th data-col="${col}" data-idx="${columnOrder.indexOf(col)}" draggable="true"
                                            style="padding:12px 16px;text-align:left;color:#94a3b8;font-weight:500;white-space:nowrap;background:#0f172a;min-width:120px;">
                                            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
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
                                            <td style="padding:12px 16px;color:#e2e8f0;min-width:120px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" 
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

            // Render into TABLE AREA only
            tableArea.innerHTML = tableHtml;

            // === Event Listeners ===

            // Export button
            document.getElementById(`exportBtn-${dbId}`)?.addEventListener('click', exportToExcel);

            // Shift + Scroll for horizontal scrolling
            const scrollContainer = document.getElementById(`tableScrollContainer-${dbId}`);
            if (scrollContainer) {
                scrollContainer.addEventListener('wheel', (e) => {
                    if (e.shiftKey) {
                        e.preventDefault();
                        scrollContainer.scrollLeft += e.deltaY * 2;
                    }
                }, { passive: false });
            }

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

            // Assignee Filter
            document.getElementById(`assigneeFilter-${dbId}`)?.addEventListener('change', (e) => {
                assigneeTableFilter = e.target.value;
                currentPage = 1;
                applyFiltersAndSearch();
                renderTable();
                // Dashboard already updated via applyFiltersAndSearch
            });

            // Listen for dashboard filter changes (custom event)
            // Dashboard already re-renders itself, we only need to update table
            document.addEventListener('dashboard-filter-change', (e) => {
                if (e.detail) {
                    const { startDate, endDate, assigneeFilter, sprintFilter } = e.detail;
                    console.log('[RawTable] dashboard-filter-change:', { startDate, endDate, assigneeFilter, sprintFilter, dateCol });

                    startDateFilter = startDate || '';
                    endDateFilter = endDate || '';
                    assigneeTableFilter = assigneeFilter || '';
                    sprintTableFilter = sprintFilter || '';
                    currentPage = 1;

                    // Reset debug flag for new filter operation
                    window._dateDebugLogged = false;

                    // Skip dashboard update since it triggered this event
                    filteredData = originalData.filter(row => {
                        if (assigneeTableFilter && assigneeCol && row[assigneeCol] !== assigneeTableFilter) return false;
                        if (sprintTableFilter && sprintCol && row[sprintCol] !== sprintTableFilter) return false;
                        if (dateCol && (startDateFilter || endDateFilter)) {
                            let d = parseDate(row[dateCol]);
                            if (!d && fallbackDateCol) d = parseDate(row[fallbackDateCol]);
                            // Include tasks without dates, only filter if date exists
                            if (d) {
                                if (startDateFilter && d < new Date(startDateFilter)) return false;
                                if (endDateFilter) {
                                    const end = new Date(endDateFilter);
                                    end.setHours(23, 59, 59, 999);
                                    if (d > end) return false;
                                }
                            }
                        }
                        return true;
                    });
                    console.log('[RawTable] After filter:', { originalCount: originalData.length, filteredCount: filteredData.length });
                    renderTable();
                }
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

        // Calculate default date range (this month)
        const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const formatDateForInput = (date) => {
            if (!date) return '';
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        const formatDateDisplay = (date) => {
            if (!date) return '';
            return date.toLocaleDateString('vi-VN');
        };

        // Get date presets
        const getPresets = () => ({
            'thisMonth': {
                label: 'Tháng này',
                start: new Date(now.getFullYear(), now.getMonth(), 1),
                end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
            },
            'lastMonth': {
                label: 'Tháng trước',
                start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
                end: new Date(now.getFullYear(), now.getMonth(), 0)
            },
            'last2Months': {
                label: '2 tháng',
                start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
                end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
            },
            'last3Months': {
                label: '3 tháng',
                start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
                end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
            },
            'thisQuarter': {
                label: 'Quý này',
                start: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1),
                end: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0)
            },
            'last6Months': {
                label: '6 tháng',
                start: new Date(now.getFullYear(), now.getMonth() - 5, 1),
                end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
            },
            'thisYear': {
                label: 'Năm nay',
                start: new Date(now.getFullYear(), 0, 1),
                end: new Date(now.getFullYear(), 11, 31)
            }
        });

        const presets = getPresets();
        let activePreset = 'thisMonth';

        container.innerHTML = `
            <div class="report-toolbar" style="background:#1e293b;padding:16px;border-radius:12px;margin-bottom:20px;border:1px solid #334155;">
                <!-- Date Range Filter Section -->
                <div class="date-range-section" style="margin-bottom:16px;padding:12px;background:#0f172a;border-radius:8px;border:1px solid #334155;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                        <span style="color:#94a3b8;font-size:0.85rem;font-weight:500;">📅 Khoảng thời gian:</span>
                        <div class="date-presets" style="display:flex;gap:6px;flex-wrap:wrap;">
                            ${Object.entries(presets).map(([key, preset]) => `
                                <button class="prod-preset-btn ${activePreset === key ? 'active' : ''}" data-preset="${key}" 
                                    style="padding:4px 10px;font-size:0.75rem;border-radius:6px;border:1px solid ${activePreset === key ? '#3b82f6' : '#475569'};
                                    background:${activePreset === key ? '#3b82f6' : 'transparent'};color:${activePreset === key ? '#fff' : '#94a3b8'};
                                    cursor:pointer;transition:all 0.2s ease;white-space:nowrap;">
                                    ${preset.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <label style="color:#94a3b8;font-size:0.8rem;">Từ ngày:</label>
                            <input type="date" id="prod-start-date" value="${formatDateForInput(defaultStart)}" 
                                style="padding:6px 10px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:0.85rem;">
                        </div>
                        <span style="color:#64748b;">→</span>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <label style="color:#94a3b8;font-size:0.8rem;">Đến ngày:</label>
                            <input type="date" id="prod-end-date" value="${formatDateForInput(defaultEnd)}" 
                                style="padding:6px 10px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:0.85rem;">
                        </div>
                    </div>
                </div>
                
                <!-- Other Settings -->
                <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
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
                <!-- Database chips section hidden - user requested cleaner UI -->
                <div id="prod-db-section" style="display:none;border-top:1px solid #334155;padding-top:12px;">
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

        const startDateInput = document.getElementById('prod-start-date');
        const endDateInput = document.getElementById('prod-end-date');
        const stdDaysInput = document.getElementById('prod-std-days');
        const refreshBtn = document.getElementById('prod-refresh-btn');
        const bodyContainer = document.getElementById('prod-report-body');
        const userFilter = document.getElementById('prod-user-filter');
        const dbChipsContainer = document.getElementById('prod-db-chips');
        const dbCountSpan = document.getElementById('prod-db-count');
        const toggleDbsBtn = document.getElementById('prod-toggle-dbs');

        // Preset button handlers
        container.querySelectorAll('.prod-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetKey = btn.dataset.preset;
                const preset = presets[presetKey];

                startDateInput.value = preset.start ? formatDateForInput(preset.start) : '';
                endDateInput.value = preset.end ? formatDateForInput(preset.end) : '';
                activePreset = presetKey;

                // Update active state
                container.querySelectorAll('.prod-preset-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.background = 'transparent';
                    b.style.borderColor = '#475569';
                    b.style.color = '#94a3b8';
                });
                btn.classList.add('active');
                btn.style.background = '#3b82f6';
                btn.style.borderColor = '#3b82f6';
                btn.style.color = '#fff';

                // NOTE: Removed auto-fetch - user must click "Cập nhật" button
            });

            // Hover effect
            btn.addEventListener('mouseenter', () => {
                if (!btn.classList.contains('active')) {
                    btn.style.borderColor = '#3b82f6';
                    btn.style.color = '#e2e8f0';
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (!btn.classList.contains('active')) {
                    btn.style.borderColor = '#475569';
                    btn.style.color = '#94a3b8';
                }
            });
        });

        // Manual date input clears preset highlight
        [startDateInput, endDateInput].forEach(input => {
            input.addEventListener('change', () => {
                container.querySelectorAll('.prod-preset-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.background = 'transparent';
                    b.style.borderColor = '#475569';
                    b.style.color = '#94a3b8';
                });
                activePreset = '';
            });
        });

        // Store full data for filtering
        let fullReportData = [];
        let reportColumns = [];
        let currentDateRange = '';
        let chipsExpanded = true;  // Track chips panel state

        // NEW: State for column visibility, pagination
        let hiddenColumns = new Set();
        let currentPage = 1;
        let pageSize = 10;
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
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (!startDate || !endDate) {
                bodyContainer.innerHTML = '<div class="error-state" style="padding:40px;text-align:center;color:#f59e0b;">⚠️ Vui lòng chọn khoảng thời gian</div>';
                return;
            }

            currentDateRange = `${formatDateDisplay(new Date(startDate))} → ${formatDateDisplay(new Date(endDate))}`;

            bodyContainer.innerHTML = '<div class="loading-state" style="padding:40px;text-align:center;color:#94a3b8;">⏳ Đang tính toán dữ liệu...</div>';

            // Lấy CHỈ Task database IDs (filter từ selectedDatabases)
            const taskDbIds = this.getSelectedTaskDatabases();

            if (taskDbIds.length === 0) {
                bodyContainer.innerHTML = `
                    <div class="error-state" style="padding:40px;text-align:center;color:#f59e0b;">
                        ⚠️ Không có database Task nào được chọn<br>
                        <span style="font-size:0.85rem;color:#94a3b8;">Báo cáo năng suất chỉ lấy dữ liệu từ database Task</span>
                    </div>`;
                return;
            }

            try {
                // Get standard days from input
                const standardDays = parseFloat(stdDaysInput.value) || 23;

                const response = await fetch(`${API_BASE}/api/reports/productivity`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        startDate: startDate,
                        endDate: endDate,
                        databaseIds: taskDbIds,
                        standardDays: standardDays
                    })
                });
                const result = await response.json();

                if (result.success) {
                    // DEBUG: Show Filter Stats
                    if (result.filterStats) {
                        console.log("=== PRODUCTIVITY REPORT DEBUG ===");
                        console.log("Total Processed:", result.filterStats.totalProcessed);
                        console.log("Total Accepted:", result.filterStats.totalAccepted);
                        console.log("Rejected (Status):", result.filterStats.rejectedStatus);
                        console.log("Rejected (Date Missing):", result.filterStats.rejectedDateMissing);
                        console.log("Rejected (Date Range):", result.filterStats.rejectedDateRange);
                        console.log("Missing Assignee:", result.filterStats.missingAssignee);
                        console.log("=================================");

                        let sampleMsg = "";
                        if (result.filterStats.missingDateSamples && result.filterStats.missingDateSamples.length > 0) {
                            sampleMsg = "\n\n[MẪU TASK MẤT NGÀY]: (Xem tên cột bên dưới có cột Ngày ko?)\n" +
                                result.filterStats.missingDateSamples.map(s => `- "${s.name}" (${s.project})\n  Cột có sẵn: ${s.props}`).join('\n\n');
                        }

                        // alert(`[DEBUG REPORT]\nProcessed: ${result.filterStats.totalProcessed}\nAccepted: ${result.filterStats.totalAccepted}\nRejected (Status): ${result.filterStats.rejectedStatus}\nRejected (Date): ${result.filterStats.rejectedDateMissing + result.filterStats.rejectedDateRange}\nMissing Assignee: ${result.filterStats.missingAssignee}${sampleMsg}\n\nXem thêm chi tiết ở Console (F12).`);

                        // alert(`[DEBUG REPORT]\nProcessed: ${result.filterStats.totalProcessed}...`);

                        // Store stats for persistent rendering
                        currentFilterStats = result.filterStats;
                    }

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

                    // Reset flags and render with dashboard
                    dashboardRendered = false;
                    warningRendered = false;
                    applyFilterAndRender(true);
                } else {
                    bodyContainer.innerHTML = `<div class="error-state" style="padding:40px;text-align:center;color:#ef4444;">${result.error || 'Lỗi không xác định'}</div>`;
                }
            } catch (err) {
                console.error('Fetch Report Error:', err);
                bodyContainer.innerHTML = `<div class="error-state" style="padding:40px;text-align:center;color:#ef4444;">Lỗi kết nối: ${err.message}</div>`;
            }
        };

        const renderReportSummary = (stats, container) => {
            // Remove existing summary
            container.querySelector('.report-summary')?.remove();

            const projects = stats.projects || [];
            const div = document.createElement('div');
            div.className = 'report-summary alert alert-success d-flex align-items-center mb-4 shadow-sm';
            div.style.borderLeft = '5px solid #198754'; // Bootstrap success color
            div.innerHTML = `
                <i class="bi bi-check-circle-fill fs-2 me-3 text-success"></i>
                <div>
                    <h5 class="alert-heading mb-1 fw-bold">Đã tổng hợp dữ liệu thành công!</h5>
                    <div class="mb-1">
                        <span class="badge bg-success me-2">Tổng: ${stats.totalProcessed.toLocaleString()}</span>
                        <span class="badge bg-primary">Hợp lệ: ${stats.totalAccepted.toLocaleString()}</span>
                    </div>
                    <div class="small text-muted mt-1">
                        <i class="bi bi-database me-1"></i> Dữ liệu từ <strong>${projects.length}</strong> dự án: ${projects.join(', ')}
                    </div>
                </div>
            `;
            // Insert at top of container (but check if Dashboard renders first?)
            // We want it visible. Prepend is good.
            container.prepend(div);
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
        let currentFilterStats = null; // State for report summary
        let dashboardRendered = false; // Flag to prevent re-rendering dashboard
        let warningRendered = false; // Flag to prevent re-rendering warning

        // Render dashboard and warning ONCE (separate from table)
        const renderDashboardAndWarning = () => {
            // Remove existing dashboard/warning if any
            // Remove existing dashboard/warning/summary if any
            bodyContainer.querySelector('.prod-dashboard')?.remove();
            bodyContainer.querySelector('.unmapped-warning')?.remove();
            bodyContainer.querySelector('.report-summary')?.remove();

            // Render Report Summary (Success State)
            if (currentFilterStats) {
                renderReportSummary(currentFilterStats, bodyContainer);
            }

            // Render Productivity Dashboard (only once, with full data)
            if (typeof window.renderProductivityDashboard === 'function' && fullReportData.length > 0) {
                window.renderProductivityDashboard(fullReportData, bodyContainer);
            }

            // Show Warning for Unmapped Users - simple list without task details
            if (currentUnknownUsers.length > 0) {
                const warningHtml = `
                <div class="unmapped-warning" style="background:#1e3a5f;color:#93c5fd;padding:16px;margin:16px;border-radius:8px;border:1px solid #3b82f6;font-size:0.9rem;">
                    <strong>⚠️ Phát hiện nhân sự chưa được mapping (Dữ liệu này đang bị ẩn):</strong>
                    <ul style="margin:8px 0 0 20px;padding:0;">
                        ${currentUnknownUsers.map(u => `<li style="margin:4px 0;">👤 <strong>${u.name}</strong> (${u.taskCount} tasks)</li>`).join('')}
                    </ul>
                    <div style="margin-top:12px;font-size:0.8rem;opacity:0.8;">
                        Vui lòng báo Admin thêm "Name Alias" cho các tên này để hệ thống gộp đúng vào nhân sự chính thức.
                    </div>
                </div>`;
                bodyContainer.insertAdjacentHTML('afterbegin', warningHtml);
            }

            dashboardRendered = true;
            warningRendered = true;
        };

        // Only render table (for pagination/filter changes)
        const applyFilterAndRender = (renderDashToo = false) => {
            const filterVal = userFilter.value;
            let filteredData = fullReportData;

            if (filterVal) {
                filteredData = fullReportData.filter(r => r.fullName === filterVal);
            }

            renderTable(filteredData, reportColumns, currentDateRange);

            // Only render dashboard/warning on initial load or when explicitly requested
            if (renderDashToo || !dashboardRendered) {
                renderDashboardAndWarning();
            }
        };

        // User filter change handler
        userFilter.addEventListener('change', applyFilterAndRender);

        const updateStats = async (updates) => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            try {
                await fetch(`${API_BASE}/api/reports/productivity/update-stats`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ startDate, endDate, updates })
                });
                // NOTE: Do NOT call fetchReport() here
                // User must click "Cập nhật" button to reload table
                // Local recalculation is done by recalculateRow()
            } catch (err) {
                console.error('Update Stats Error:', err);
                alert('Không lưu được dữ liệu');
            }
        };

        const renderTable = (data, columns, dateRange) => {
            if (!data || data.length === 0) {
                bodyContainer.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:#64748b;">Không có dữ liệu cho khoảng thời gian này.</div>';
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
                .prod-table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 0.85rem; color: #e2e8f0; }
                .prod-table th { background: #0f172a; padding: 12px 16px; border: 1px solid #334155; text-align: left; font-weight: 600; white-space: nowrap; color: #94a3b8; min-width: 120px; }
                .prod-table td { padding: 10px 16px; border: 1px solid #334155; background: #1e293b; min-width: 100px; }
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
                .prod-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 16px; background:#0f172a; border-bottom: 1px solid #334155; }
                .prod-toolbar-btn { padding: 6px 12px; background:#334155; border: none; border-radius: 4px; color: #e2e8f0; cursor: pointer; font-size: 0.8rem; transition:all 0.15s; }
                .prod-toolbar-btn:hover { background:#475569; }
                .prod-toolbar-btn.primary { background:#3b82f6; }
                .prod-toolbar-btn.primary:hover { background:#2563eb; }
                .prod-toolbar-btn.success { background:#22c55e; }
                .prod-toolbar-btn.success:hover { background:#16a34a; }
                .prod-col-picker { position: absolute; right: 0; top: 100%; z-index: 100; background:#1e293b; border: 1px solid #475569; border-radius: 8px; padding: 8px; max-height: 300px; overflow-y: auto; min-width: 220px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
                .prod-col-picker label { display: flex; align-items: center; gap: 8px; padding: 4px 8px; cursor: pointer; color: #e2e8f0; font-size: 0.8rem; }
                .prod-col-picker label:hover { background:#334155; border-radius: 4px; }
                .prod-pagination { display: flex; gap: 6px; align-items: center; justify-content: center; padding: 12px; background:#0f172a; border-top: 1px solid #334155; }
                .prod-pagination-btn { padding: 6px 12px; background:#334155; border: none; border-radius: 4px; color: #e2e8f0; cursor: pointer; font-size: 0.8rem; }
                .prod-pagination-btn:hover:not(:disabled) { background:#475569; }
                .prod-pagination-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .prod-pagination-btn.active { background:#3b82f6; }
                .prod-scroll-container {
                    overflow-x: auto;
                    overflow-y: auto;
                    max-height: 600px;
                    margin: 0 16px 16px;
                    scrollbar-width: thin;
                    scrollbar-color: #475569 #1e293b;
                }
                .prod-scroll-container::-webkit-scrollbar { height: 10px; width: 10px; }
                .prod-scroll-container::-webkit-scrollbar-track { background: #1e293b; border-radius: 5px; }
                .prod-scroll-container::-webkit-scrollbar-thumb { background: #475569; border-radius: 5px; }
                .prod-scroll-container::-webkit-scrollbar-thumb:hover { background: #64748b; }
                .prod-scroll-hint {
                    display: flex; align-items: center; gap: 6px;
                    padding: 6px 12px; background: rgba(59, 130, 246, 0.1);
                    border-radius: 4px; font-size: 0.75rem; color: #94a3b8;
                    margin: 8px 16px;
                }
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
                <!-- Scroll Hint -->
                <div class="prod-scroll-hint">
                    <span>🖱️</span>
                    <span>Shift + Lăn chuột để cuộn ngang | Ctrl+D để copy giá trị xuống các dòng dưới</span>
                </div>
                <div class="prod-scroll-container" id="prod-scroll-container">
                    <table class="prod-table">
                        <thead>
                            <tr>
                                <th style="width: 50px; min-width: 50px;">STT</th>
                                ${visibleCols.filter(c => c.id !== 'stt').map(c => `<th style="min-width:120px;">${c.name}</th>`).join('')}
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
                        // If null, show "Chờ" (waiting for pointReq data)
                        if (val === null || val === undefined) {
                            cellContent = `<div class="num-cell" style="color:#64748b;font-style:italic;">Chờ</div>`;
                        } else {
                            const percent = (parseFloat(val) || 0) * 100;
                            cellContent = `<div class="num-cell">${percent.toFixed(1)}%</div>`;
                        }
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

            // Shift + Scroll for horizontal scrolling
            const prodScrollContainer = document.getElementById('prod-scroll-container');
            if (prodScrollContainer) {
                prodScrollContainer.addEventListener('wheel', (e) => {
                    if (e.shiftKey) {
                        e.preventDefault();
                        prodScrollContainer.scrollLeft += e.deltaY * 2;
                    }
                }, { passive: false });
            }

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
                a.download = `Bao_cao_nang_suat_${currentDateRange.replace(/[\s→\/]/g, '_')}.csv`;
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
                a.download = `Bao_cao_nang_suat_${currentDateRange.replace(/[\s→\/]/g, '_')}.xls`;
                a.click();
                URL.revokeObjectURL(url);
            });
        };

        // Event Listeners
        refreshBtn.addEventListener('click', fetchReport);

        // NOTE: Removed auto-update on stdDaysInput change
        // User must click "Cập nhật" to apply changes

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

                // NOTE: Removed auto-fetch on page load
                // User must select a report type and click "Tạo Báo Cáo" to see data
                // Just update the button state to reflect saved selections
                this.updateGenerateButtonState();
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

        // 1. Get whitelist IDs set for filtering (match by ID ONLY)
        const whitelistIds = new Set(this.whitelistProjects);

        // Filter projectsHierarchy to get pinned projects (by ID only)
        const pinnedProjects = [];
        for (const proj of this.projectsHierarchy) {
            // Only include if ID matches whitelist
            if (!whitelistIds.has(proj.id)) continue;

            // Search filter
            const matchesSearch = !query ||
                proj.name.toLowerCase().includes(query) ||
                (proj.databases && proj.databases.some(db => db.name.toLowerCase().includes(query)));
            if (!matchesSearch) continue;

            // Check if user manually hid this project
            if (this.hiddenProjects.has(proj.name) && !query) continue;

            pinnedProjects.push(proj);
        }

        // 2. Other projects = projectsHierarchy MINUS whitelist (by ID only)
        const otherProjects = [];
        const hiddenProjectsList = [];

        for (const project of this.projectsHierarchy) {
            // Skip if in whitelist (we handle whitelist separately)
            if (whitelistIds.has(project.id)) continue;

            // Search filter
            const matchesSearch = !query ||
                project.name.toLowerCase().includes(query) ||
                (project.databases && project.databases.some(db => db.name.toLowerCase().includes(query)));
            if (!matchesSearch) continue;

            const isManuallyHidden = this.hiddenProjects.has(project.name) && !query;
            if (isManuallyHidden) {
                hiddenProjectsList.push(project);
            } else {
                otherProjects.push(project);
            }
        }

        // 3. Render Pinned Projects (DIRECTLY from whitelist JSON)
        let hasPinnedContent = false;
        if (pinnedProjects.length > 0) {
            hasPinnedContent = true;
            mainHtml += `<div class="pinned-projects-header" style="padding: 8px 16px; font-size: 0.75rem; color: #94a3b8; font-weight: 600; text-transform: uppercase;">🌟 Dự án ưu tiên (${pinnedProjects.length})</div>`;
            mainHtml += this.renderProjectList(pinnedProjects, false, true); // isPinnedSection = true
        }

        // 4. Render Other Projects (Non-whitelist - mặc định đóng)
        if (otherProjects.length > 0) {
            const style = this.isHiddenGroupOpen ? 'display: block;' : 'display: none;';
            const arrow = this.isHiddenGroupOpen ? '▼' : '▶';

            mainHtml += `
                <div class="other-projects-header" onclick="app.toggleHiddenGroup()" style="margin-top: 16px; border-top: 1px dashed #475569;">
                    ${arrow} Dự án khác (${otherProjects.length})
                </div>
                <div id="other-projects-list" style="${style}">
                    ${this.renderProjectList(otherProjects, false, false)} 
                </div>
            `;
        }

        // 5. Render Hidden Projects Section (Đã ẩn thủ công)
        if (hiddenProjectsList.length > 0) {
            mainHtml += `
                <div class="other-projects-header" onclick="app.toggleHiddenProjectsSection()" style="margin-top: 16px; border-top: 1px dashed #475569;">
                    ${this.isHiddenProjectsOpen ? '▼' : '▶'} 🚫 Dự án đã ẩn (${hiddenProjectsList.length})
                </div>
            `;
            if (this.isHiddenProjectsOpen) {
                mainHtml += `<div id="hidden-projects-list">${this.renderProjectList(hiddenProjectsList, true)}</div>`;
            }
        }

        // 5. Render Hidden Databases Section (Database đã ẩn)
        const hiddenDbsList = this.getHiddenDatabasesList();
        if (hiddenDbsList.length > 0) {
            mainHtml += `
                <div class="other-projects-header" onclick="app.toggleHiddenDatabasesSection()" style="margin-top: 16px; border-top: 1px dashed #ef4444;">
                    ${this.isHiddenDatabasesOpen ? '▼' : '▶'} 🙈 Database đã ẩn (${hiddenDbsList.length})
                </div>
            `;
            if (this.isHiddenDatabasesOpen) {
                mainHtml += `<div id="hidden-databases-list" style="padding: 8px 12px;">
                    ${hiddenDbsList.map(db => `
                        <div class="hidden-db-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin:4px 0;background:#1e293b;border-radius:6px;border:1px solid #ef444440;">
                            <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                                <span style="font-size:0.85rem;">${this.getDatabaseIcon(db.type)}</span>
                                <span style="color:#e2e8f0;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(db.name)}">${this.escapeHtml(db.name)}</span>
                                <span style="color:#64748b;font-size:0.7rem;">(${this.escapeHtml(db.projectName)})</span>
                            </div>
                            <button onclick="event.stopPropagation(); app.toggleDatabaseVisibility('${db.id}')" 
                                    style="padding:4px 8px;background:#22c55e;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:0.7rem;white-space:nowrap;"
                                    title="Hiện database">
                                👁 Hiện
                            </button>
                        </div>
                    `).join('')}
                </div>`;
            }
        }

        if (!hasPinnedContent && otherProjects.length === 0 && hiddenProjectsList.length === 0 && hiddenDbsList.length === 0) {
            mainHtml = '<div class="no-data" style="padding:20px; text-align:center; color:#64748b;">Không tìm thấy kết quả</div>';
        }

        treeContainer.innerHTML = mainHtml;

        // Restore scroll
        if (scrollPos > 0) treeContainer.scrollTop = scrollPos;
    }

    renderProjectList(projects, isHiddenSection = false, isPinnedSection = false) {
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
            const eyeAction = `event.stopPropagation(); app.toggleProjectVisibility('${safeProjectName.replace(/'/g, "\\\\'")}')`;
            // Note: toggleProjectVisibility logic handles boolean toggle.

            // Pin/Unpin Button
            const pinAction = isPinnedSection
                ? `event.stopPropagation(); app.unpinProject('${project.id}', '${safeProjectName.replace(/'/g, "\\\\'")}')`
                : `event.stopPropagation(); app.pinProject('${project.id}', '${safeProjectName.replace(/'/g, "\\\\'")}')`;
            const pinTitle = isPinnedSection ? 'Bỏ ghim khỏi whitelist' : 'Ghim vào whitelist';
            const pinIcon = isPinnedSection ? '📌❌' : '📌';

            html += `
                <div class="project-group">
                     <div class="project-header" data-project="${safeProjectName}" onclick="app.toggleProjectExpand('${projectId}-databases', this)">
                        <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
                        <div class="project-label" title="${safeProjectName}" style="display:flex;align-items:center;">
                            ${safeProjectName}
                            ${statusBadge}
                            ${projectCountLabel}
                        </div>
                        
                        <!-- Pin/Unpin Button -->
                        <div class="pin-toggle" onclick="${pinAction}" title="${pinTitle}" 
                             style="cursor:pointer;font-size:0.75rem;margin-right:4px;padding:2px 4px;border-radius:4px;background:${isPinnedSection ? '#fbbf2420' : '#3b82f620'};border:1px solid ${isPinnedSection ? '#fbbf2440' : '#3b82f640'};">
                            ${pinIcon}
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

    toggleHiddenDatabasesSection() {
        this.isHiddenDatabasesOpen = !this.isHiddenDatabasesOpen;
        this.renderProjectsTreeHierarchical();
    }

    // Lấy danh sách database đã ẩn với thông tin project
    getHiddenDatabasesList() {
        const result = [];
        for (const project of this.projectsHierarchy) {
            const databases = project.databases || [];
            for (const db of databases) {
                if (this.hiddenDatabases.has(db.id)) {
                    result.push({
                        id: db.id,
                        name: db.name,
                        type: db.type,
                        projectName: project.name
                    });
                }
            }
        }
        return result;
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

        // Clear welcome section before rendering data
        const container = document.getElementById('report-container');
        if (container) {
            const welcomeSection = container.querySelector('.welcome-section');
            if (welcomeSection) {
                container.innerHTML = '';
            }
        }

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
                    // DEBUG: Show Filter Stats
                    if (result.filterStats) {
                        console.log("=== PRODUCTIVITY REPORT DEBUG ===");
                        console.log("Total Processed:", result.filterStats.totalProcessed);
                        console.log("Total Accepted:", result.filterStats.totalAccepted);
                        console.log("Rejected (Status):", result.filterStats.rejectedStatus);
                        console.log("Rejected (Date Missing):", result.filterStats.rejectedDateMissing);
                        console.log("Rejected (Date Range):", result.filterStats.rejectedDateRange);
                        console.log("=================================");

                        // Show small toast/notify if accepted count is low (optional, but good for user)
                        // alert(`Debug: Processed ${result.filterStats.totalProcessed} tasks. Accepted: ${result.filterStats.totalAccepted}. Check Console for details.`);
                    }

                    // Render Dashboard
                    if (window.renderProductivityDashboard) {
                        this.updateDatabaseCounts(dbId, result.data.length);
                        // Render Table (Simplified for this snippet)
                        this.renderDatabaseData(dbId, result.data, result.meta);
                    }
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

    // Pin a project to the whitelist (persisted to backend)
    async pinProject(projectId, projectName) {
        try {
            const response = await fetch('/api/whitelist/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, projectName, action: 'pin' })
            });
            const result = await response.json();

            if (result.success) {
                // Reload whitelist from backend
                await this.loadWhitelistProjects();
                this.renderProjectsTreeHierarchical();
                console.log(`[App] ✅ Pinned project: ${projectName}`);
                this.showToast(`📌 Đã ghim "${projectName}" vào whitelist`);
            } else {
                console.error('[App] Pin failed:', result.error);
                this.showToast(`❌ Lỗi: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('[App] Pin error:', error);
            this.showToast(`❌ Lỗi kết nối: ${error.message}`, 'error');
        }
    }

    // Unpin a project from the whitelist (persisted to backend)
    async unpinProject(projectId, projectName) {
        try {
            const response = await fetch('/api/whitelist/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, projectName, action: 'unpin' })
            });
            const result = await response.json();

            if (result.success) {
                // Reload whitelist from backend
                await this.loadWhitelistProjects();
                this.renderProjectsTreeHierarchical();
                console.log(`[App] ✅ Unpinned project: ${projectName}`);
                this.showToast(`📌❌ Đã bỏ ghim "${projectName}" khỏi whitelist`);
            } else {
                console.error('[App] Unpin failed:', result.error);
                this.showToast(`❌ Lỗi: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('[App] Unpin error:', error);
            this.showToast(`❌ Lỗi kết nối: ${error.message}`, 'error');
        }
    }

    // Simple toast notification
    showToast(message, type = 'success') {
        // Check if toast container exists
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `padding:12px 20px;border-radius:8px;color:#fff;font-size:0.9rem;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn 0.3s ease;background:${type === 'error' ? '#ef4444' : '#22c55e'};`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        // Auto remove after 3s
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Load whitelist projects from backend
    async loadWhitelistProjects() {
        try {
            const response = await fetch('/api/whitelist');
            const data = await response.json();
            if (data.success) {
                this.whitelistProjects = new Set();
                this.whitelistProjectNames = new Set();
                (data.projects || []).forEach(proj => {
                    this.whitelistProjects.add(proj.id);
                    this.whitelistProjectNames.add(proj.name);
                });
                console.log(`[App] Loaded ${this.whitelistProjects.size} whitelist projects`);
            }
        } catch (error) {
            console.error('[App] Error loading whitelist:', error);
        }
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

        // Clear welcome section and any non-db-section content
        const welcomeSection = container.querySelector('.welcome-section');
        if (welcomeSection) welcomeSection.remove();
        const emptyState = container.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
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
        let pageSize = 10; // Default: 10 rows

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
                                <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                                <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                                <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
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
        if (text === null || text === undefined) return '';
        if (typeof text !== 'string') text = String(text);
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

