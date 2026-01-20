// app.js - Tree Structure UI with 2 view modes
const API_BASE = window.location.origin;

class DashboardApp {
    constructor() {
        this.projects = {};
        this.selectedProject = null;
        this.selectedDatabase = null;
        this.viewMode = null; // 'aggregated' or 'raw'
    }

    async init() {
        console.log('[Dashboard] Initializing...');
        await this.loadProjectsTree();
        this.setupEventListeners();
    }

    async loadProjectsTree() {
        console.log('[Dashboard] Loading projects tree...');
        try {
            const response = await fetch(`${API_BASE}/api/databases/grouped`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('[Dashboard] Received projects:', data);

            if (data.success && data.projects) {
                this.projects = data.projects;
                console.log(`[Dashboard] Loaded ${Object.keys(this.projects).length} projects`);
                this.renderProjectsTree();
            } else {
                console.error('[Dashboard] No projects in response');
                this.showError('Không tìm thấy dự án.');
            }
        } catch (error) {
            console.error('[Dashboard] Error loading projects:', error);
            this.showError(`❌ Lỗi kết nối: ${error.message}`);
        }
    }

    renderProjectsTree() {
        const treeContainer = document.getElementById('project-tree');
        if (!treeContainer || Object.keys(this.projects).length === 0) {
            treeContainer.innerHTML = '<div class="no-data">Chưa có dữ liệu dự án</div>';
            return;
        }

        let html = '';

        for (const [projectName, databases] of Object.entries(this.projects)) {
            // Safe ID generation
            const projectId = `project-${projectName.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const isProjectSelected = this.selectedProject === projectName;

            html += `
                <li class="project-group">
                    <div class="project-header" data-project="${projectName}">
                        <i class="ri-arrow-right-s-line" style="transition: transform 0.2s; margin-right: 5px; ${isProjectSelected ? 'transform: rotate(90deg);' : ''}"></i>
                        <input type="checkbox" 
                            data-project="${projectName}"
                            ${isProjectSelected ? 'checked' : ''}
                        >
                        <label title="${projectName}">${projectName}</label>
                        <span class="count">${databases.length}</span>
                    </div>
                    <ul class="database-list ${isProjectSelected ? 'expanded' : ''}" id="${projectId}-databases">
                        ${databases.map(db => {
                const dbId = `db-${db.id}`;
                const isDbSelected = this.selectedDatabase == db.id;
                return `
                                <li class="database-item">
                                    <input type="checkbox" id="${dbId}" data-db-id="${db.id}" data-db-name="${db.name}" ${isDbSelected ? 'checked' : ''}>
                                    <label for="${dbId}" title="${db.name}">📊 ${db.name}</label>
                                </li>
                            `;
            }).join('')}
                    </ul>
                </li>
            `;
        }

        treeContainer.innerHTML = html;
    }

    setupEventListeners() {
        const treeContainer = document.getElementById('project-tree');
        if (!treeContainer) return;

        // Handle checkbox changes
        treeContainer.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                const projectName = e.target.dataset.project;
                const dbId = e.target.dataset.dbId;

                if (projectName) {
                    this.handleProjectSelection(projectName, e.target.checked);
                } else if (dbId) {
                    this.handleDatabaseSelection(dbId, e.target.dataset.dbName, e.target.checked);
                }
            }
        });

        // Helper to toggle project
        window.toggleProject = (projectName) => {
            const projectId = `project-${projectName.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const dbList = document.getElementById(`${projectId}-databases`);
            const header = document.querySelector(`.project-header[data-project="${projectName}"]`);

            if (dbList) {
                dbList.classList.toggle('expanded');
                const icon = header?.querySelector('.ri-arrow-right-s-line');
                if (icon) {
                    icon.style.transform = dbList.classList.contains('expanded') ? 'rotate(90deg)' : 'rotate(0deg)';
                }
                console.log(`[Dashboard] Toggled project: ${projectName}`);
            } else {
                console.error(`[Dashboard] Could not find list for project: ${projectName} (ID: ${projectId}-databases)`);
            }
        };

        // Handle header clicks to expand/collapse via Delegation
        treeContainer.addEventListener('click', (e) => {
            // Priority 1: Handle Project Header Click
            const header = e.target.closest('.project-header');
            if (header && e.target.tagName !== 'INPUT') {
                e.stopPropagation(); // Stop bubbling
                const projectName = header.dataset.project;
                window.toggleProject(projectName);
                return; // Stop processing
            }

            // Priority 2: Handle Database Item Click
            const sidebarItem = e.target.closest('.database-item');
            if (sidebarItem) {
                // 1. If clicked on Input: Native behavior. Do nothing.
                if (e.target.tagName === 'INPUT') return;

                // 2. If clicked on Label: Native behavior (browser clicks input). Do nothing.
                if (e.target.closest('label')) return;

                // 3. If clicked on the LI whitespace/padding: Manual toggle.
                e.stopPropagation();
                const checkbox = sidebarItem.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });

        // Logout button
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            window.auth?.logout();
        });
    }

    handleProjectSelection(projectName, checked) {
        console.log(`[Dashboard] Project ${projectName} ${checked ? 'selected' : 'deselected'} `);

        if (checked) {
            this.uncheckAll();
            document.querySelector(`input[data-project="${projectName}"]`).checked = true;

            this.selectedProject = projectName;
            this.selectedDatabase = null;
            this.viewMode = 'aggregated';

            this.loadAggregatedReport(projectName);
        } else {
            this.selectedProject = null;
            this.clearView();
        }
    }

    handleDatabaseSelection(dbId, dbName, checked) {
        console.log(`[Dashboard] Database ${dbName} ${checked ? 'selected' : 'deselected'} `);

        if (checked) {
            this.uncheckAll();
            document.querySelector(`input[data-db-id="${dbId}"]`).checked = true;

            this.selectedDatabase = dbId;
            this.selectedProject = null;
            this.viewMode = 'raw';

            this.loadRawData(dbId);
        } else {
            this.selectedDatabase = null;
            this.clearView();
        }
    }

    uncheckAll() {
        document.querySelectorAll('#project-tree input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
    }

    async loadAggregatedReport(projectName) {
        console.log(`[Dashboard] Loading aggregated report for project: ${projectName} `);

        const container = document.getElementById('report-container');
        container.innerHTML = '<div class="loading">Đang tải báo cáo...</div>';

        try {
            const response = await fetch(`${API_BASE}/api/reports/sprint`, {
                credentials: 'include'
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Unknown error');

            // Filter data for this project
            const projectData = result.data.filter(row => row.project === projectName);

            container.innerHTML = '';
            this.renderSprintReport(projectData);

        } catch (error) {
            console.error('[Dashboard] Error:', error);
            container.innerHTML = `<div class="error">Lỗi: ${error.message}</div>`;
        }
    }

    async loadRawData(dbId) {
        console.log(`[Dashboard] Loading raw data for database: ${dbId}`);

        const container = document.getElementById('report-container');
        container.innerHTML = '<div class="loading">Đang tải dữ liệu...</div>';

        try {
            const response = await fetch(`${API_BASE}/api/database/${dbId}/raw`, {
                credentials: 'include'
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            container.innerHTML = '';

            if (window.renderRawDataTable) {
                window.renderRawDataTable(result, container);
            } else {
                container.innerHTML = '<div class="error">Raw data module not loaded</div>';
            }

        } catch (error) {
            console.error('[Dashboard] Error:', error);
            container.innerHTML = `<div class="error">Lỗi: ${error.message}</div>`;
        }
    }

    clearView() {
        const container = document.getElementById('report-container');
        container.innerHTML = `
            <div class="welcome-message">
                <h3>Welcome to Notion Dashboard</h3>
                <p>Chọn một dự án hoặc database từ sidebar để xem dữ liệu</p>
            </div>
        `;
    }

    showError(message) {
        const container = document.getElementById('report-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #f87171;">
                    <p>${message}</p>
                    <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #6366f1; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Tải lại trang
                    </button>
                </div>
            `;
        }
    }

    // Keep existing renderSprintReport method from old app.js
    renderSprintReport(data) {
        const container = document.getElementById('report-container');

        // State for pagination
        let currentPage = 1;
        let pageSize = 10;
        let filteredData = [...data];

        // Create filter container
        const filterDiv = document.createElement('div');
        filterDiv.style.cssText = 'margin-bottom: 1.5rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; max-width: 100%;';

        // Helper to create filter dropdown
        const createFilter = (label, id) => {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 0.25rem;';

            const labelEl = document.createElement('label');
            labelEl.textContent = label;
            labelEl.style.cssText = 'font-size: 0.875rem; color: rgba(255,255,255,0.7);';

            const select = document.createElement('select');
            select.id = id;
            select.style.cssText = 'padding: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white; width: 100%; max-width: 100%;';

            select.setAttribute('size', '1');

            wrapper.appendChild(labelEl);
            wrapper.appendChild(select);
            return { wrapper, select };
        };

        const productFilter = createFilter('Product', 'filter-product');
        const sprintFilter = createFilter('Sprint', 'filter-sprint');
        const assigneeFilter = createFilter('Assignee', 'filter-assignee');

        filterDiv.appendChild(productFilter.wrapper);
        filterDiv.appendChild(sprintFilter.wrapper);
        filterDiv.appendChild(assigneeFilter.wrapper);

        container.appendChild(filterDiv);

        // Populate filters
        const populateFilters = (baseData = data) => {
            const productVal = productFilter.select.value;
            const sprintVal = sprintFilter.select.value;

            let dataForFilters = [...baseData];

            if (productVal && productVal !== 'all') {
                dataForFilters = dataForFilters.filter(r => r.product === productVal);
            }
            if (sprintVal && sprintVal !== 'all') {
                dataForFilters = dataForFilters.filter(r => r.sprint === sprintVal);
            }

            const products = ['all', ...new Set(baseData.map(r => r.product).filter(p => p))];
            productFilter.select.innerHTML = products.map(p =>
                `<option value="${p}" ${p === productVal ? 'selected' : ''}>${p === 'all' ? 'Tất cả' : p}</option>`
            ).join('');

            const sprints = ['all', ...new Set(dataForFilters.map(r => r.sprint))];
            sprintFilter.select.innerHTML = sprints.map(s =>
                `<option value="${s}" ${s === sprintVal ? 'selected' : ''}>${s === 'all' ? 'Tất cả' : s}</option>`
            ).join('');

            const assignees = ['all', ...new Set(dataForFilters.map(r => r.assignee))];
            assigneeFilter.select.innerHTML = assignees.map(a =>
                `<option value="${a}" ${a === assigneeFilter.select.value ? 'selected' : ''}>${a === 'all' ? 'Tất cả' : a}</option>`
            ).join('');
        };

        populateFilters();

        // Chart container
        const chartDiv = document.createElement('div');
        chartDiv.className = 'chart-container';
        chartDiv.innerHTML = '<h3>Task Points by Sprint</h3><canvas id="sprint-chart"></canvas>';
        chartDiv.style.marginBottom = '2rem';
        container.appendChild(chartDiv);

        // Pagination controls
        const paginationTop = document.createElement('div');
        paginationTop.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;';

        const pageSizeSelector = document.createElement('div');
        pageSizeSelector.style.cssText = 'display: flex; gap: 0.5rem; align-items: center;';
        pageSizeSelector.innerHTML = `
            <span style="font-size: 0.875rem; color: rgba(255,255,255,0.7);">Hiển thị:</span>
            <select id="page-size" style="padding: 0.25rem 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white;">
                <option value="10" selected>10</option>
                <option value="20">20</option>
                <option value="50">50</option>
            </select>
            <span style="font-size: 0.875rem; color: rgba(255,255,255,0.7);">dòng</span>
        `;

        const pageInfo = document.createElement('div');
        pageInfo.id = 'page-info';
        pageInfo.style.cssText = 'font-size: 0.875rem; color: rgba(255,255,255,0.7);';

        paginationTop.appendChild(pageSizeSelector);
        paginationTop.appendChild(pageInfo);
        container.appendChild(paginationTop);

        // Table container
        const tableDiv = document.createElement('div');
        tableDiv.className = 'table-container';
        container.appendChild(tableDiv);

        // Pagination bottom
        const paginationBottom = document.createElement('div');
        paginationBottom.id = 'pagination-controls';
        paginationBottom.style.cssText = 'display: flex; gap: 0.5rem; justify-content: center; margin-top: 1rem;';
        container.appendChild(paginationBottom);

        // Update view
        const updateView = () => {
            const prodVal = productFilter.select.value;
            const sVal = sprintFilter.select.value;
            const aVal = assigneeFilter.select.value;

            filteredData = data.filter(row => {
                return (prodVal === 'all' || row.product === prodVal) &&
                    (sVal === 'all' || row.sprint === sVal) &&
                    (aVal === 'all' || row.assignee === aVal);
            });

            currentPage = 1;

            if (window.renderSprintChart) {
                window.renderSprintChart(filteredData);
            }

            renderTable();
        };

        const renderTable = () => {
            const start = (currentPage - 1) * pageSize;
            const end = start + pageSize;
            const pageData = filteredData.slice(start, end);
            const totalPages = Math.ceil(filteredData.length / pageSize);

            tableDiv.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Sprint</th>
                            <th>Assignee</th>
                            <th>Confirmed</th>
                            <th>Unconfirmed</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pageData.map(row => `
                            <tr>
                                <td>${row.product || '-'}</td>
                                <td>${row.sprint}</td>
                                <td>${row.assignee}</td>
                                <td>${row.confirmed_points}</td>
                                <td>${row.unconfirmed_points}</td>
                                <td><strong>${row.total_points}</strong></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            document.getElementById('page-info').textContent =
                `Hiển thị ${start + 1}-${Math.min(end, filteredData.length)} / ${filteredData.length} dòng`;

            // Render pagination
            paginationBottom.innerHTML = '';
            if (totalPages > 1) {
                const prevBtn = document.createElement('button');
                prevBtn.textContent = '← Trước';
                prevBtn.disabled = currentPage === 1;
                prevBtn.style.cssText = `padding: 0.5rem 1rem; background: ${currentPage === 1 ? 'rgba(255,255,255,0.05)' : 'rgba(99,102,241,0.8)'}; color: white; border: none; border-radius: 4px; cursor: ${currentPage === 1 ? 'not-allowed' : 'pointer'};`;
                prevBtn.onclick = () => { currentPage--; renderTable(); };
                paginationBottom.appendChild(prevBtn);

                const nextBtn = document.createElement('button');
                nextBtn.textContent = 'Sau →';
                nextBtn.disabled = currentPage === totalPages;
                nextBtn.style.cssText = `padding: 0.5rem 1rem; background: ${currentPage === totalPages ? 'rgba(255,255,255,0.05)' : 'rgba(99,102,241,0.8)'}; color: white; border: none; border-radius: 4px; cursor: ${currentPage === totalPages ? 'not-allowed' : 'pointer'};`;
                nextBtn.onclick = () => { currentPage++; renderTable(); };
                paginationBottom.appendChild(nextBtn);
            }
        };

        // Event listeners
        productFilter.select.addEventListener('change', () => {
            populateFilters();
            updateView();
        });
        sprintFilter.select.addEventListener('change', updateView);
        assigneeFilter.select.addEventListener('change', updateView);
        document.getElementById('page-size').addEventListener('change', (e) => {
            pageSize = parseInt(e.target.value);
            currentPage = 1;
            renderTable();
        });

        updateView();
    }
}

// Initialize app
const app = new DashboardApp();
app.init();
