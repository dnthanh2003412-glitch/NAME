import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseDiscovery } from '../notion/discovery.js';
import { DataFetcher } from '../notion/fetcher.js';
import { ProjectsService } from '../notion/projects.js';
import { DatabaseManager } from '../database/db.js';
import { reportRegistry } from '../reports/index.js';
import { ProductivityService } from '../reports/productivity.js';
import { COLUMNS as PROD_COLUMNS } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// In-memory cache for database discovery
let databasesCache = null;
let databasesCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Load priority projects whitelist
function loadPriorityProjects() {
    try {
        const priorityPath = path.join(__dirname, '..', '..', 'data', 'priority_projects.json');
        if (fs.existsSync(priorityPath)) {
            const data = JSON.parse(fs.readFileSync(priorityPath, 'utf8'));
            return data;
        }
    } catch (error) {
        console.error('[Routes] Warning: Could not load priority_projects.json:', error.message);
    }
    return { projects: [], priority_databases: [] };
}

export function setupRoutes(app, db, poller) {
    const notionToken = process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN;
    const globalProjectsService = notionToken ? new ProjectsService(notionToken) : null;

    // Helper: Get databases with cache
    const getCachedDatabases = async () => {
        const now = Date.now();
        if (databasesCache && (now - databasesCacheTime) < CACHE_TTL) {
            return databasesCache;
        }
        const discovery = new DatabaseDiscovery(notionToken);
        databasesCache = await discovery.discoverDatabases();
        databasesCacheTime = now;
        console.log(`[Cache] Refreshed databases cache: ${databasesCache.length} databases`);
        return databasesCache;
    };

    // ============ AUTH ROUTES ============
    app.get('/auth/status', (req, res) => {
        res.json({
            authenticated: !!notionToken,
            configured: !!notionToken
        });
    });

    app.post('/auth/setup', (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });
        req.session.configured = true;
        res.json({ success: true });
    });

    app.post('/auth/logout', (req, res) => {
        req.session.destroy();
        res.json({ success: true });
    });

    // ============ WHITELIST / PRIORITY ROUTES ============
    app.get('/api/whitelist', (req, res) => {
        try {
            const priorityData = loadPriorityProjects();
            res.json({
                success: true,
                projects: priorityData.projects || [],
                priority_databases: priorityData.priority_databases || []
            });
        } catch (error) {
            console.error('[API] Error loading whitelist:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Pin/Unpin a project to/from the whitelist
    app.post('/api/whitelist/pin', async (req, res) => {
        const { projectId, projectName, action } = req.body; // action: 'pin' or 'unpin'

        if (!projectId || !action) {
            return res.status(400).json({ error: 'projectId and action are required' });
        }

        try {
            const priorityPath = path.join(__dirname, '..', '..', 'data', 'priority_projects.json');
            const priorityData = loadPriorityProjects();

            if (action === 'pin') {
                // Check if already pinned
                const alreadyPinned = priorityData.projects.some(p => p.id === projectId);
                if (alreadyPinned) {
                    return res.json({ success: true, message: 'Project already pinned', alreadyPinned: true });
                }

                // Get project info from active_project_structure.json
                const structurePath = path.join(__dirname, '..', '..', 'data', 'active_project_structure.json');
                let projectInfo = null;

                if (fs.existsSync(structurePath)) {
                    const structureData = JSON.parse(fs.readFileSync(structurePath, 'utf8'));
                    projectInfo = structureData.find(p => p.id === projectId);
                }

                if (!projectInfo) {
                    // Create minimal project info if not found in structure
                    projectInfo = {
                        name: projectName || 'Unknown Project',
                        id: projectId,
                        databases: []
                    };
                }

                // Extract project code from name (e.g., "[DeeDee_2025_SUN] Sunny Side Down" -> "SUN")
                const codeMatch = projectInfo.name.match(/\[.*?_(\w+)\]/);
                const code = codeMatch ? codeMatch[1] : projectInfo.name.slice(0, 5).toUpperCase();

                // Prepare databases with type detection
                const databases = (projectInfo.databases || []).map(db => {
                    let type = 'other';
                    const dbName = (db.title || db.name || '').toLowerCase();
                    if (dbName.includes('task')) type = 'tasks';
                    else if (dbName.includes('product')) type = 'products';
                    else if (dbName.includes('sprint')) type = 'sprints';
                    else if (dbName.includes('report') || dbName.includes('báo cáo')) type = 'reports';
                    else if (dbName.includes('issue')) type = 'issues';

                    return {
                        id: db.id,
                        name: db.title || db.name || 'Unknown',
                        type: type
                    };
                });

                // Add to projects array
                const newProject = {
                    name: projectInfo.name,
                    id: projectId,
                    code: code,
                    databases: databases
                };
                priorityData.projects.push(newProject);

                // Add database IDs to priority_databases array
                databases.forEach(db => {
                    if (!priorityData.priority_databases.includes(db.id)) {
                        priorityData.priority_databases.push(db.id);
                    }
                });

                // Update description
                priorityData.description = `Whitelist dự án ưu tiên - gồm ${priorityData.projects.length} dự án`;

                console.log(`[API] ✅ Pinned project: ${projectInfo.name}`);
            } else if (action === 'unpin') {
                // Find and remove project
                const projectIndex = priorityData.projects.findIndex(p => p.id === projectId);
                if (projectIndex === -1) {
                    return res.json({ success: true, message: 'Project not in whitelist', notFound: true });
                }

                const removedProject = priorityData.projects[projectIndex];

                // Remove database IDs from priority_databases
                const dbIdsToRemove = (removedProject.databases || []).map(db => db.id);
                priorityData.priority_databases = priorityData.priority_databases.filter(
                    dbId => !dbIdsToRemove.includes(dbId)
                );

                // Remove project from array
                priorityData.projects.splice(projectIndex, 1);

                // Update description
                priorityData.description = `Whitelist dự án ưu tiên - gồm ${priorityData.projects.length} dự án`;

                console.log(`[API] ✅ Unpinned project: ${removedProject.name}`);
            } else {
                return res.status(400).json({ error: 'Invalid action. Use "pin" or "unpin"' });
            }

            // Save updated priority_projects.json
            fs.writeFileSync(priorityPath, JSON.stringify(priorityData, null, 2), 'utf8');

            res.json({
                success: true,
                action: action,
                projectCount: priorityData.projects.length,
                databaseCount: priorityData.priority_databases.length
            });
        } catch (error) {
            console.error('[API] Error updating whitelist:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============ DATABASE ROUTES ============
    app.get('/api/databases', async (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });
        try {
            const discovery = new DatabaseDiscovery(notionToken);
            const databases = await discovery.discoverDatabases();
            res.json({ success: true, databases });
        } catch (error) {
            console.error('[API] Error listing databases:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/databases/select', async (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });
        const { database_ids } = req.body;
        if (!database_ids || !Array.isArray(database_ids)) {
            return res.status(400).json({ error: 'database_ids must be an array' });
        }
        try {
            db.setConfig('selected_databases', database_ids);
            db.setConfig('access_token', notionToken);
            console.log(`[API] ✅ Saved ${database_ids.length} selected databases`);
            res.json({ success: true, count: database_ids.length });
        } catch (error) {
            console.error('[API] Error saving databases:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/databases/selected', (req, res) => {
        try {
            const selected = db.getConfig('selected_databases') || [];
            res.json({ success: true, databases: selected });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/databases/grouped', async (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });
        try {
            const discovery = new DatabaseDiscovery(notionToken);
            const allDatabases = await discovery.discoverDatabases();
            const grouped = {};
            for (const db of allDatabases) {
                const projectName = extractProjectName(db.name);
                if (!grouped[projectName]) grouped[projectName] = [];
                grouped[projectName].push({
                    id: db.id,
                    name: db.name,
                    full_name: db.name,
                    properties: db.properties
                });
            }
            res.json({ success: true, projects: grouped });
        } catch (error) {
            console.error('[API] Error grouping databases:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============ PROJECTS TREE ROUTES ============

    // Get hierarchical project tree from [Chung]Dự án
    app.get('/api/projects/tree', async (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });
        if (!globalProjectsService) return res.status(500).json({ error: 'Service not initialized' });

        const statusFilter = req.query.status || 'all';

        try {
            // Use Singleton's internal cache mechanism
            const projects = await globalProjectsService.getProjectsTree({ statusFilter });
            res.json({ success: true, projects, cached: true });
        } catch (error) {
            console.error('[API] Error fetching projects tree:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get data for a specific child database
    app.get('/api/projects/database/:id', async (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });

        const { id } = req.params;

        try {
            // Check cache first
            const cachedData = db.getData(id);
            if (cachedData && cachedData.length > 0) {
                console.log(`[API] Returning cached data for database ${id}`);
                return res.json({ success: true, data: cachedData, cached: true, meta: { title: id } });
            }

            // Fetch fresh data using DataFetcher
            const fetcher = new DataFetcher(notionToken);
            const result = await fetcher.fetchAllData([id]);
            const data = result[id] || [];

            // Cache it
            db.saveData(id, data);

            console.log(`[Fetcher] ✅ Database ${id.slice(0, 8)}...: ${data.length} records`);
            res.json({ success: true, data, cached: false, meta: { title: id } });
        } catch (error) {
            console.error(`[API] Error fetching database ${id}:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // Clear projects tree cache
    app.post('/api/projects/refresh', async (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });

        try {
            // Clear cache
            db.setConfig('projects_tree_active', null);
            db.setConfig('projects_tree_active_time', null);
            db.setConfig('projects_tree_all', null);
            db.setConfig('projects_tree_all_time', null);

            console.log('[API] Cleared projects tree cache');
            res.json({ success: true, message: 'Cache cleared' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/database/:id/raw', async (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });
        const { id } = req.params;
        try {
            let cachedData = db.getData(id);

            // If missing or empty, auto-fetch from Notion
            if (!cachedData || cachedData.length === 0) {
                console.log(`[API] Raw data missing for ${id}, fetching from Notion...`);
                try {
                    const fetcher = new DataFetcher(notionToken);
                    const result = await fetcher.fetchAllData([id]);
                    cachedData = result[id] || [];

                    if (cachedData.length > 0) {
                        db.saveData(id, cachedData);
                        console.log(`[API] Fetched and cached ${cachedData.length} records for ${id}`);
                    }
                } catch (fetchError) {
                    console.error(`[API] Failed to auto-fetch data for ${id}:`, fetchError);
                    // Fallthrough to error response below if still empty
                }
            }

            if (!cachedData || cachedData.length === 0) {
                return res.json({ success: false, error: 'No data available for this database.' });
            }

            // Use cached databases to get name (fast!)
            const allDatabases = await getCachedDatabases();
            const dbInfo = allDatabases.find(d => d.id === id);

            // --- Use in-memory lookup cache (FAST!) ---
            const { lookupMap, userMap: globalUserMap } = db.getLookupMaps();

            const columns = new Set();
            cachedData.forEach(record => {
                if (record.properties) Object.keys(record.properties).forEach(key => columns.add(key));
            });

            console.log(`[API] Columns for ${id}:`, Array.from(columns));

            const formattedData = cachedData.map(record => {
                const row = {};
                columns.forEach(col => {
                    const originalVal = record.properties?.[col];
                    const val = formatValue(originalVal, lookupMap, globalUserMap);
                    row[col] = val;
                });
                return row;
            });
            res.json({
                success: true,
                database_id: id,
                database_name: dbInfo?.name || 'Unknown Database',
                columns: Array.from(columns),
                data: formattedData,
                total_records: formattedData.length
            });
        } catch (error) {
            console.error(`[API] Error getting raw data:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============ REPORT ROUTES ============
    app.get('/api/reports', (req, res) => {
        const reports = reportRegistry.getAllReports();
        res.json({ success: true, reports });
    });

    app.get('/api/reports/:reportName', async (req, res) => {
        const { reportName } = req.params;
        try {
            const rawData = db.getAllData();
            if (Object.keys(rawData).length === 0) {
                return res.json({ success: false, error: 'No data available.' });
            }
            const result = await reportRegistry.generateReport(reportName, rawData);
            res.json(result);
        } catch (error) {
            console.error(`[API] Error generating report ${reportName}:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============ PRODUCTIVITY REPORT ROUTES ============
    app.post('/api/reports/productivity', async (req, res) => {
        const { startDate, endDate, databaseIds, standardDays } = req.body; // YYYY-MM-DD format

        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate are required' });
        }

        try {
            const prodService = new ProductivityService(db);

            // If standardDays is provided, save it first
            if (standardDays !== undefined && standardDays !== null) {
                prodService.updateStats(startDate, endDate, { standard_days: standardDays });
            }

            // Ưu tiên dùng databaseIds từ request, fallback về config
            const selectedDatabases = databaseIds && databaseIds.length > 0
                ? databaseIds
                : (db.getConfig('selected_databases') || []);

            if (selectedDatabases.length === 0) {
                return res.json({ success: true, columns: PROD_COLUMNS, data: [], error: 'No projects selected' });
            }

            const { validData, unknownUsers } = await prodService.generateReport(startDate, endDate, selectedDatabases);
            const stats = prodService.getStats(startDate, endDate);

            res.json({
                success: true,
                columns: PROD_COLUMNS,
                data: validData,
                unknownUsers,
                stats,
                meta: { startDate, endDate }
            });
        } catch (error) {
            console.error('[API] Productivity Report Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/reports/productivity/update-stats', async (req, res) => {
        const { startDate, endDate, updates } = req.body;
        if (!startDate || !endDate || !updates) return res.status(400).json({ error: 'Missing parameters' });

        try {
            const prodService = new ProductivityService(db);
            const newStats = prodService.updateStats(startDate, endDate, updates);
            res.json({ success: true, stats: newStats });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ============ STATUS ROUTES ============
    app.get('/api/status', (req, res) => {
        const lastUpdate = db.getLastUpdate();
        const selectedDatabases = db.getConfig('selected_databases') || [];
        res.json({
            success: true,
            status: 'running',
            last_update: lastUpdate,
            databases_count: selectedDatabases.length,
            authenticated: !!notionToken,
            configured: !!notionToken
        });
    });

    // ============ SYSTEM ROUTES ============
    app.post('/api/refresh', async (req, res) => {
        if (!poller) {
            return res.status(503).json({ error: 'Pooling service not available' });
        }
        try {
            console.log('[API] Triggering manual refresh...');
            await poller.triggerPoll();
            // Rebuild lookup cache after refresh
            db.buildLookupCache();
            res.json({ success: true, message: 'Data refreshed successfully' });
        } catch (error) {
            console.error('[API] Refresh failed:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Rebuild lookup cache (for debugging / maintenance)
    app.post('/api/cache/rebuild', (req, res) => {
        try {
            const startTime = Date.now();
            db.buildLookupCache();
            const elapsed = Date.now() - startTime;
            const { lookupMap, userMap } = db.getLookupMaps();
            res.json({
                success: true,
                message: 'Lookup cache rebuilt',
                stats: {
                    lookupEntries: lookupMap.size,
                    userEntries: userMap.size,
                    elapsedMs: elapsed
                }
            });
        } catch (error) {
            console.error('[API] Cache rebuild failed:', error);
            res.status(500).json({ error: error.message });
        }
    });

    console.log('[Routes] ✅ All routes registered');
}


function extractProjectName(databaseName) {
    // Priority: Extract content inside square brackets [Project Name]
    const listPattern = /^\[(.*?)\]/;
    const match = databaseName.match(listPattern);
    if (match && match[1]) {
        return match[1].trim();
    }

    // Fallback: Remove suffixes
    const patterns = [
        / - Product$/i, / - Task$/i, / - Sprint$/i,
        /_Product$/i, /_Task$/i, /_Sprint$/i,
        /Product$/i, /Task$/i, /Sprint$/i
    ];
    let projectName = databaseName;
    for (const pattern of patterns) {
        projectName = projectName.replace(pattern, '').trim();
    }
    return projectName.replace(/[-_\s]+$/, '').trim() || databaseName;
}

/**
 * Helper: Format Notion property value for display (Enhanced Recursive with Lookup)
 */
function formatValue(value, lookupMap = new Map(), globalUserMap = new Map()) {
    // 1. Null/Undefined
    if (value === null || value === undefined) return '';

    // 2. Arrays (Rollup array, Rich Text array, Relation array, etc.)
    if (Array.isArray(value)) {
        if (value.length === 0) return '';

        // Map over items and format recursively
        const formatted = value.map(v => formatValue(v, lookupMap, globalUserMap))
            .filter(v => v !== ''); // Filter empty strings

        // Dedupe to avoid "D, D, D, D, D" display issues
        const unique = [...new Set(formatted)];
        return unique.join(', ');
    }

    // 3. Objects
    if (typeof value === 'object') {

        // --- Notion Type Wrapper --- 
        // Example: { type: "rollup", rollup: { ... } }
        if (value.type && value[value.type] !== undefined) {
            return formatValue(value[value.type], lookupMap, globalUserMap);
        }

        // --- Specific Object Structures ---

        // Rollup specific (sometimes has 'array' property inside)
        if (value.array && Array.isArray(value.array)) {
            return formatValue(value.array, lookupMap, globalUserMap);
        }

        // Title / Rich Text / Text
        if (value.plain_text) return value.plain_text;
        if (value.content) return value.content;

        // Select / Status / Multi-select item
        if (value.name) return value.name;

        // User / People object - Prioritize name over email, but use Map if name is email-like
        if (value.object === 'user' || value.email !== undefined) {
            let name = value.name || value.email || 'Unknown User';
            // Enhance name from map if it looks like an email or is fallback
            if (name.includes('@') && globalUserMap.has(name.toLowerCase().trim())) {
                name = globalUserMap.get(name.toLowerCase().trim());
            }
            return name;
        }

        // People object from fetcher (has name and email)
        if (value.name && value.id) {
            let name = value.name;
            if (name.includes('@') && globalUserMap.has(name.toLowerCase().trim())) {
                name = globalUserMap.get(name.toLowerCase().trim());
            }
            return name;
        }

        // Formula
        if (value.string !== undefined) return value.string;
        if (value.number !== undefined) return String(value.number);
        if (value.boolean !== undefined) return String(value.boolean);

        // Date
        if (value.start) return value.end ? `${value.start} → ${value.end}` : value.start;

        // Checkbox
        if (value.checkbox !== undefined) return String(value.checkbox);

        // URL / Email / Phone
        if (value.url) return value.url;
        if (value.email) return value.email;
        if (value.phone_number) return value.phone_number;

        // Relation Resolution
        // If it's a raw relation object { id: "..." }, we try to look it up.
        if (value.id) {
            const id = value.id.toLowerCase();
            // Check lookup map first
            if (lookupMap.has(id)) {
                return lookupMap.get(id);
            }
            // Fallback: If it's a Relation but not found in map, maybe return a placeholder or just ID
            return value.id;
        }

        // --- Fallback for Deeply Nested / Unknown Objects ---
        try {
            // Handle Title / Rich Text arrays directly if wrapped as object accidentally
            if (value.title && Array.isArray(value.title)) return formatValue(value.title, lookupMap, globalUserMap);
            if (value.rich_text && Array.isArray(value.rich_text)) return formatValue(value.rich_text, lookupMap, globalUserMap);

            // If object has a single key that is an object/array, try diving in
            const keys = Object.keys(value);
            if (keys.length === 1 && typeof value[keys[0]] === 'object') {
                return formatValue(value[keys[0]], lookupMap, globalUserMap);
            }

            // If it has 'string' / 'number' property directly
            if ('string' in value) return value.string;
            if ('number' in value) return String(value.number);

            // Last resort: simple string check
            return JSON.stringify(value).replace(/[{"}]/g, '');
        } catch {
            return '[Complex Data]';
        }
    }

    // 4. Primitives (String, Number, Boolean)
    const strVal = String(value);

    // UUID regex check to avoid false positives on normal text
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strVal);

    if (isUUID) {
        const id = strVal.toLowerCase();
        if (lookupMap.has(id)) {
            return lookupMap.get(id);
        }
    }

    // Check if primitive is an email we can resolve
    if (strVal.includes('@') && globalUserMap.has(strVal.toLowerCase().trim())) {
        return globalUserMap.get(strVal.toLowerCase().trim());
    }

    // Also try checking map even if not strict UUID (for some system IDs)
    if (strVal.length > 20) {
        const id = strVal.toLowerCase();
        if (lookupMap.has(id)) {
            return lookupMap.get(id);
        }
    }

    return strVal;
}
