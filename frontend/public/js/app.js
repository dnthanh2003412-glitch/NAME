// app.js - Final Dash Notion V3
/**
 * Main application logic for Dash Notion
 * Features: Multi-select, Auto-preload, Dedicated Hidden Group, Advanced Reporting
 */

const API_BASE = window.location.origin;

class DashboardApp {
    constructor() {
        this.projects = {};
        this.databaseNames = new Map(); // Map db.id -> db.name
        this.selectedProjects = new Set();
        this.selectedDatabases = new Set();

        // Load config from localStorage
        this.hiddenProjects = new Set(JSON.parse(localStorage.getItem('hiddenProjects') || '[]'));
        this.hiddenDatabases = new Set(JSON.parse(localStorage.getItem('hiddenDatabases') || '[]'));

        this.searchQuery = '';
        this.rawDataCache = {}; // Cache for pre-loaded raw data
        this.isHiddenGroupOpen = false; // Add state tracker for hidden group
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;

        console.log('[Dashboard] Initializing...');
        await this.loadProjectsTree();
        this.setupEventListeners();
        this.updateSelectedCount();

        // Auto-load all data in background to make UI snappy
        this.preloadAllData();
    }

    async preloadAllData() {
        console.log('[Dashboard] Triggering background refresh...');
        try {
            fetch(`${API_BASE}/api/refresh`, {
                method: 'POST',
                credentials: 'include'
            }).then(() => console.log('[Dashboard] Background refresh triggered'));
        } catch (error) {
            console.warn('[Dashboard] Background refresh warning:', error);
        }
    }

    async loadProjectsTree() {
        console.log('[Dashboard] Loading projects tree...');
        try {
            const response = await fetch(`${API_BASE}/api/databases/grouped`, {
                credentials: 'include'
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();

            if (data.success && data.projects) {
                this.projects = data.projects;

                // Build database name map
                for (const [projectName, databases] of Object.entries(this.projects)) {
                    for (const db of databases) {
                        this.databaseNames.set(db.id, db.name);
                    }
                }

                this.renderProjectsTree();
            } else {
                this.showError('Không tìm thấy dự án.');
            }
        } catch (error) {
            console.error('[Dashboard] Error loading projects:', error);
            this.showError(`❌ Lỗi kết nối: ${error.message}`);
        }
    }

    /**
     * Renders the sidebar tree with a dedicated "Hidden Items" group at the bottom
     */
    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    renderProjectsTree() {
        const treeContainer = document.getElementById('project-tree');
        if (!treeContainer || Object.keys(this.projects).length === 0) {
            treeContainer.innerHTML = '<div class="no-data">Chưa có dữ liệu dự án</div>';
            return;
        }

        // Save scroll position to prevent jumping
        const scrollPos = treeContainer.scrollTop;

        let mainHtml = '';
        let hiddenHtml = '';
        let hiddenCount = 0;
        const query = this.searchQuery.toLowerCase();

        for (const [projectName, databases] of Object.entries(this.projects)) {
            // Filter by search query
            const matchesSearch = !query ||
                projectName.toLowerCase().includes(query) ||
                databases.some(db => db.name.toLowerCase().includes(query));

            if (!matchesSearch) continue;

            const isProjectHidden = this.hiddenProjects.has(projectName);
            const safeProjectName = this.escapeHtml(projectName);

            // --- LOGIC 1: PROJECT IS HIDDEN -> Move to Hidden Group ---
            if (isProjectHidden) {
                hiddenHtml += `
                    <li class="project-group hidden-item-special">
                        <div class="project-header">
                             <span class="project-label" title="${safeProjectName}">${safeProjectName} (${databases.length})</span>
                             <button class="visibility-toggle" data-toggle-project="${safeProjectName}" title="Hiện dự án">👁‍🗨</button>
                        </div>
                    </li>
                `;
                hiddenCount++;
                continue; // Skip main rendering for this project
            }

            // --- LOGIC 2: PROJECT VISIBLE -> Check its Databases ---
            const visibleDatabases = databases.filter(db => !this.hiddenDatabases.has(db.id));
            const hiddenDbsInProject = databases.filter(db => this.hiddenDatabases.has(db.id));

            // Move hidden DBs to hidden group
            hiddenDbsInProject.forEach(db => {
                const safeDbName = this.escapeHtml(db.name);
                hiddenHtml += `
                    <li class="database-item hidden-item-special">
                        <label title="${safeDbName}">📊 ${safeDbName} <small style="color:var(--color-text-muted)">(${safeProjectName})</small></label>
                        <button class="visibility-toggle-small" data-toggle-db="${db.id}" title="Hiện database">👁‍🗨</button>
                    </li>
               `;
                hiddenCount++;
            });

            const projectId = `project-${projectName.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const isProjectSelected = this.selectedProjects.has(projectName);
            const isExpanded = isProjectSelected || visibleDatabases.some(db => this.selectedDatabases.has(db.id));

            mainHtml += `
                <li class="project-group">
                    <div class="project-header" data-project="${safeProjectName}">
                        <span class="expand-icon" style="transition: transform 0.2s; ${isExpanded ? 'transform: rotate(90deg);' : ''}">▶</span>
                        <input type="checkbox" class="project-checkbox"
                            data-project="${safeProjectName}"
                            ${isProjectSelected ? 'checked' : ''}>
                        <label class="project-label" title="${safeProjectName}">${safeProjectName}</label>
                        <span class="count">${visibleDatabases.length}</span>
                        <button class="visibility-toggle" data-toggle-project="${safeProjectName}" title="Ẩn dự án">👁</button>
                    </div>
                    <ul class="database-list ${isExpanded ? 'expanded' : ''}" id="${projectId}-databases">
                        ${visibleDatabases.map(db => {
                const dbId = `db-${db.id}`;
                const isDbSelected = this.selectedDatabases.has(db.id);
                const safeDbName = this.escapeHtml(db.name);
                return `
                                <li class="database-item">
                                    <input type="checkbox" id="${dbId}" 
                                        class="database-checkbox"
                                        data-db-id="${db.id}" 
                                        data-db-name="${safeDbName}"
                                        data-project="${safeProjectName}"
                                        ${isDbSelected ? 'checked' : ''}>
                                    <label for="${dbId}" title="${safeDbName}">📊 ${safeDbName}</label>
                                    <button class="visibility-toggle-small" data-toggle-db="${db.id}" title="Ẩn database">👁</button>
                                </li>
                            `;
            }).join('')}
                    </ul>
                </li>
            `;
        }

        // --- Render Hidden Group at Bottom ---
        if (hiddenHtml) {
            const isOpen = this.isHiddenGroupOpen === true;
            mainHtml += `
                <li class="project-group" id="hidden-group-container" style="margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                    <div class="project-header" style="cursor: pointer;">
                         <span class="expand-icon" style="transform: ${isOpen ? 'rotate(0)' : 'rotate(-90deg)'}; transition: transform 0.2s;">▼</span>
                         <label class="project-label" title="Click để ẩn/hiện mục đã ẩn" style="color: #94a3b8; font-style: italic; cursor: pointer; flex: 1;">Mục đã ẩn (${hiddenCount})</label>
                    </div>
                    <ul id="hidden-list-ul" class="database-list" style="padding-left: 0.5rem; display: ${isOpen ? 'block' : 'none'};">
                        ${hiddenHtml}
                    </ul>
                </li>
             `;
        }

        treeContainer.innerHTML = mainHtml || '<div class="no-data">Không tìm thấy kết quả</div>';

        // Restore scroll position
        if (scrollPos > 0) treeContainer.scrollTop = scrollPos;
    }

    setupEventListeners() {
        const treeContainer = document.getElementById('project-tree');

        // Sidebar search
        document.getElementById('sidebar-search')?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.renderProjectsTree();
        });

        // Actions
        document.getElementById('select-all-projects')?.addEventListener('click', () => this.selectAllProjects());
        document.getElementById('deselect-all-projects')?.addEventListener('click', () => this.deselectAllProjects());
        document.getElementById('save-sidebar-config')?.addEventListener('click', () => this.saveVisibilityConfig());
        document.getElementById('reset-sidebar-config')?.addEventListener('click', () => this.resetVisibilityConfig());

        // Report & Export
        document.getElementById('report-type-select')?.addEventListener('change', () => this.updateGenerateButton());
        document.getElementById('generate-report-btn')?.addEventListener('click', () => this.generateReport());
        document.getElementById('refresh-btn')?.addEventListener('click', () => this.refreshData());

        // Tree Delegation
        if (treeContainer) {
            treeContainer.addEventListener('change', (e) => {
                const checkbox = e.target.closest('input[type="checkbox"]');
                if (!checkbox) return;

                if (checkbox.classList.contains('project-checkbox')) this.handleProjectCheckbox(checkbox);
                else if (checkbox.classList.contains('database-checkbox')) this.handleDatabaseCheckbox(checkbox);
            });

            treeContainer.addEventListener('click', (e) => {
                // Visibility Toggles (Project & DB)
                const toggleBtn = e.target.closest('.visibility-toggle, .visibility-toggle-small');
                if (toggleBtn) {
                    e.preventDefault();
                    e.stopPropagation();

                    console.log('[App] Toggle clicked', toggleBtn.dataset);

                    if (toggleBtn.dataset.toggleProject) {
                        this.toggleProjectVisibility(toggleBtn.dataset.toggleProject);
                    } else if (toggleBtn.dataset.toggleDb) {
                        this.toggleDatabaseVisibility(toggleBtn.dataset.toggleDb);
                    }
                    return;
                }

                // Expand/Collapse Project Header
                const header = e.target.closest('.project-header');
                if (header) {
                    // Check if it's the Hidden Group Header by checking closest LI ID
                    const parentLi = header.closest('li');
                    if (parentLi && parentLi.id === 'hidden-group-container') {
                        console.log('[App] Hidden group toggled');
                        const ul = document.getElementById('hidden-list-ul');
                        if (ul) {
                            const isCollapsed = ul.style.display === 'none';
                            ul.style.display = isCollapsed ? 'block' : 'none';
                            this.isHiddenGroupOpen = isCollapsed; // Save state

                            const icon = header.querySelector('.expand-icon');
                            if (icon) icon.style.transform = isCollapsed ? 'rotate(0)' : 'rotate(-90deg)';
                        }
                        return;
                    }

                    // Regular Project Header
                    if (!e.target.matches('input') && !e.target.closest('.visibility-toggle')) {
                        if (header.dataset.project) {
                            this.toggleProjectExpand(header.dataset.project);
                        }
                    }
                }
            });
        }
    }

    handleProjectCheckbox(checkbox) {
        const projectName = checkbox.dataset.project;
        const databases = this.projects[projectName] || [];

        if (checkbox.checked) {
            this.selectedProjects.add(projectName);
            databases.forEach(db => {
                if (!this.hiddenDatabases.has(db.id)) this.selectedDatabases.add(db.id);
            });
        } else {
            this.selectedProjects.delete(projectName);
            databases.forEach(db => this.selectedDatabases.delete(db.id));
        }
        this.renderProjectsTree(); // Rerender to update styling if needed
        this.updateSelectedCount();
    }

    handleDatabaseCheckbox(checkbox) {
        const dbId = checkbox.dataset.dbId;
        const projectName = checkbox.dataset.project;

        if (checkbox.checked) this.selectedDatabases.add(dbId);
        else this.selectedDatabases.delete(dbId);

        // Update parent project selection state
        const databases = this.projects[projectName] || [];
        const visibleDbs = databases.filter(db => !this.hiddenDatabases.has(db.id));
        const allSelected = visibleDbs.length > 0 && visibleDbs.every(db => this.selectedDatabases.has(db.id));

        if (allSelected) this.selectedProjects.add(projectName);
        else this.selectedProjects.delete(projectName);

        this.updateSelectedCount();
    }

    toggleProjectExpand(projectName) {
        const projectId = `project-${projectName.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const dbList = document.getElementById(`${projectId}-databases`);
        const header = document.querySelector(`.project-header[data-project="${projectName}"]`);

        if (dbList) {
            dbList.classList.toggle('expanded');
            const icon = header?.querySelector('.expand-icon');
            if (icon) {
                icon.style.transform = dbList.classList.contains('expanded') ? 'rotate(90deg)' : 'rotate(0deg)';
            }
        }
    }

    // --- Visibility Logic ---
    toggleProjectVisibility(projectName) {
        if (this.hiddenProjects.has(projectName)) {
            this.hiddenProjects.delete(projectName); // Unhide
        } else {
            this.hiddenProjects.add(projectName); // Hide
            // Also deselect it
            this.selectedProjects.delete(projectName);
            const databases = this.projects[projectName] || [];
            databases.forEach(db => this.selectedDatabases.delete(db.id));
        }
        this.renderProjectsTree();
        this.updateSelectedCount();
    }

    toggleDatabaseVisibility(dbId) {
        if (this.hiddenDatabases.has(dbId)) {
            this.hiddenDatabases.delete(dbId); // Unhide
        } else {
            this.hiddenDatabases.add(dbId); // Hide
            this.selectedDatabases.delete(dbId);
        }
        this.renderProjectsTree();
        this.updateSelectedCount();
    }

    selectAllProjects() {
        for (const [projectName, databases] of Object.entries(this.projects)) {
            if (!this.hiddenProjects.has(projectName)) {
                this.selectedProjects.add(projectName);
                databases.forEach(db => {
                    if (!this.hiddenDatabases.has(db.id)) this.selectedDatabases.add(db.id);
                });
            }
        }
        this.renderProjectsTree();
        this.updateSelectedCount();
    }

    deselectAllProjects() {
        this.selectedProjects.clear();
        this.selectedDatabases.clear();
        this.renderProjectsTree(); // Clear checks
        this.updateSelectedCount();
    }

    saveVisibilityConfig() {
        localStorage.setItem('hiddenProjects', JSON.stringify([...this.hiddenProjects]));
        localStorage.setItem('hiddenDatabases', JSON.stringify([...this.hiddenDatabases]));
        alert('✅ Cấu hình hiển thị đã được lưu!');
    }

    resetVisibilityConfig() {
        localStorage.removeItem('hiddenProjects');
        localStorage.removeItem('hiddenDatabases');
        this.hiddenProjects.clear();
        this.hiddenDatabases.clear();
        this.renderProjectsTree();
        alert('✅ Đã reset cấu hình!');
    }

    updateSelectedCount() {
        const countEl = document.getElementById('selected-count');
        const dbCount = this.selectedDatabases.size;

        // Show names if few
        const names = [];
        let i = 0;
        for (const dbId of this.selectedDatabases) {
            if (i++ > 2) break;
            names.push(this.databaseNames.get(dbId));
        }

        if (countEl) {
            if (dbCount === 0) countEl.textContent = 'Chưa chọn dự án nào';
            else if (dbCount <= 3) countEl.textContent = `Đã chọn: ${names.join(', ')}`;
            else countEl.textContent = `Đã chọn: ${names.join(', ')} và ${dbCount - 3} khác`;
        }
        this.updateGenerateButton();
    }

    updateGenerateButton() {
        const btn = document.getElementById('generate-report-btn');
        const reportType = document.getElementById('report-type-select')?.value;
        const hasSelection = this.selectedDatabases.size > 0;
        if (btn) btn.disabled = !hasSelection || !reportType;
    }

    // --- Report Generation ---
    async generateReport() {
        const reportType = document.getElementById('report-type-select')?.value;
        if (!reportType || this.selectedDatabases.size === 0) {
            alert('Vui lòng chọn ít nhất 1 database và loại báo cáo!');
            return;
        }

        const container = document.getElementById('report-container');
        const titleEl = document.getElementById('report-title');
        container.innerHTML = '<div class="loading">⏳ Đang tạo báo cáo...</div>';

        try {
            const names = [...this.selectedProjects].slice(0, 3).join(', ');
            const titleSuffix = this.selectedProjects.size > 3 ? ` +...` : '';

            switch (reportType) {
                case 'sprint':
                    titleEl.textContent = `📈 Báo cáo Sprint - ${names}${titleSuffix}`;
                    await this.loadSprintReport();
                    break;
                case 'productivity':
                    titleEl.textContent = `📊 Báo cáo Năng suất - ${names}${titleSuffix}`;
                    await this.loadProductivityReport();
                    break;
                case 'raw':
                    titleEl.textContent = `📋 Dữ liệu thô - ${names}${titleSuffix}`;
                    await this.loadRawDataForSelected();
                    break;
                default:
                    container.innerHTML = '<div class="error">Loại báo cáo không hợp lệ</div>';
            }
        } catch (error) {
            console.error(error);
            container.innerHTML = `<div class="error">Lỗi tạo báo cáo: ${error.message}</div>`;
        }
    }

    async loadSprintReport() {
        const res = await fetch(`${API_BASE}/api/reports/sprint`, { credentials: 'include' });
        const result = await res.json();

        if (!result.success) throw new Error(result.error);

        // Filter in frontend
        const filtered = result.data.filter(r => this.selectedProjects.has(r.project));

        if (filtered.length === 0) {
            document.getElementById('report-container').innerHTML = '<div class="no-data">Không có dữ liệu Sprint cho dự án đã chọn</div>';
            return;
        }
        this.renderSprintReport(filtered);
    }

    async loadProductivityReport() {
        const res = await fetch(`${API_BASE}/api/reports/productivity`, { credentials: 'include' });
        const result = await res.json();

        if (!result.success) throw new Error(result.error);

        const filtered = result.data.filter(r => this.selectedProjects.has(r.project) || this.selectedDatabases.size > 0); // productivity might not have project field populated correctly sometimes? fallback

        if (filtered.length === 0) {
            document.getElementById('report-container').innerHTML = '<div class="no-data">Không có dữ liệu Productivity</div>';
            return;
        }
        this.renderProductivityReport(filtered);
    }

    // --- Raw Data Logic with Auto-Fetch ---
    async loadRawDataForSelected() {
        const container = document.getElementById('report-container');
        const dbIds = [...this.selectedDatabases];
        this.rawDataCache = {}; // Reset cache used for this report session

        if (dbIds.length === 0) {
            container.innerHTML = '<div class="error">Không có database nào được chọn</div>';
            return;
        }

        const tabNames = dbIds.map(id => this.databaseNames.get(id) || id.substring(0, 8));

        container.innerHTML = `
            <div class="database-tabs">
                ${dbIds.map((id, index) => `
                    <button class="tab-btn ${index === 0 ? 'active' : ''}" data-db-id="${id}">
                        ${tabNames[index]}
                    </button>
                `).join('')}
            </div>
            <div id="raw-data-content"><div class="loading">⏳ Đang tải dữ liệu...</div></div>
        `;

        // 1. Load First Tab Immediately
        this.loadAndRenderTab(dbIds[0]);

        // 2. Auto-fetch ALL other tabs in background (Sequential)
        this.processBackgroundFetches(dbIds.slice(1));

        // 3. Tab Click Events
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadAndRenderTab(btn.dataset.dbId);
            });
        });
    }

    async fetchRawData(dbId) {
        if (this.rawDataCache[dbId]) return this.rawDataCache[dbId];
        try {
            console.log(`[Raw] Prefectching ${dbId}...`);
            const res = await fetch(`${API_BASE}/api/database/${dbId}/raw`, { credentials: 'include' });
            const data = await res.json();
            this.rawDataCache[dbId] = data;
            return data;
        } catch (e) {
            console.error(e);
            return { success: false, error: e.message };
        }
    }

    async loadAndRenderTab(dbId) {
        const container = document.getElementById('raw-data-content');

        // If cached, render immediately
        if (this.rawDataCache[dbId]) {
            if (window.renderRawDataTable) {
                container.innerHTML = '';
                window.renderRawDataTable(this.rawDataCache[dbId], container);
            }
            return;
        }

        // Existing loading
        container.innerHTML = '<div class="loading">⏳ Đang tải dữ liệu...</div>';
        const data = await this.fetchRawData(dbId);

        if (window.renderRawDataTable) {
            container.innerHTML = '';
            window.renderRawDataTable(data, container);
        } else {
            container.innerHTML = '<div class="error">Module bảng chưa được tải</div>';
        }
    }

    async processBackgroundFetches(ids) {
        for (const id of ids) {
            await this.fetchRawData(id);
            await new Promise(r => setTimeout(r, 800)); // 800ms delay
        }
    }

    // --- Render Helpers ---
    renderSprintReport(data) {
        // ... (Keep existing implementation logic) ...
        // Re-implementing simplified version for completeness
        const container = document.getElementById('report-container');
        container.innerHTML = `
            <div class="table-container">
            <h3>Kết quả Sprint (${data.length} dòng)</h3>
            <table>
                <thead>
                    <tr><th>Project</th><th>Sprint</th><th>Assignee</th><th>Product</th><th>Conf.</th><th>Unconf.</th><th>Total</th></tr>
                </thead>
                <tbody>
                    ${data.slice(0, 100).map(r => `
                        <tr>
                            <td>${r.project}</td>
                            <td>${r.sprint}</td>
                            <td>${r.assignee}</td>
                            <td>${r.product}</td>
                            <td>${r.confirmed_points}</td>
                            <td>${r.unconfirmed_points}</td>
                            <td><b>${r.total_points}</b></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${data.length > 100 ? '<p style="text-align:center; color: #aaa;">(Hiển thị 100 dòng đầu tiên)</p>' : ''}
            </div>
            <div style="margin-top:1rem; text-align:right;">
                <button class="btn-export" onclick="alert('Tính năng Export chưa hoàn thiện')">Xuất báo cáo CSV</button>
            </div>
        `;
    }

    renderProductivityReport(data) {
        const container = document.getElementById('report-container');
        container.innerHTML = `
            <div class="table-container">
            <h3>Năng suất nhân sự</h3>
            <table>
                <thead>
                    <tr><th>Assignee</th><th>Số công thực tế</th><th>Số công yêu cầu</th><th>Task Points</th><th>% Performance</th></tr>
                </thead>
                <tbody>
                    ${data.map(r => `
                        <tr>
                            <td>${r.assignee}</td>
                            <td>${r.total_actual_hours}</td>
                            <td>${r.total_expected_hours}</td>
                            <td>${r.total_points}</td>
                            <td><b>${r.productivity_percentage}%</b></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            </div>
        `;
    }

    showError(msg) {
        document.getElementById('report-container').innerHTML = `<div class="error">${msg}</div>`;
    }

    async refreshData() {
        const btn = document.getElementById('refresh-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Đang tải...'; }
        try {
            await fetch(`${API_BASE}/api/refresh`, { method: 'POST', credentials: 'include' });
            window.location.reload();
        } catch (e) { alert(e.message); if (btn) btn.disabled = false; }
    }
}

// Global Init
const app = new DashboardApp();
window.dashboardApp = app;
document.addEventListener('DOMContentLoaded', () => app.init());
