import express from 'express';
import { DatabaseDiscovery } from '../notion/discovery.js';
import { DataFetcher } from '../notion/fetcher.js';
import { ProjectsService } from '../notion/projects.js';
import { DatabaseManager } from '../database/db.js';
import { reportRegistry } from '../reports/index.js';

const router = express.Router();

export function setupRoutes(app, db, poller) {
    const notionToken = process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN;
    const globalProjectsService = notionToken ? new ProjectsService(notionToken) : null;

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

        const statusFilter = req.query.status || 'active';

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
            const cachedData = db.getData(id);
            if (!cachedData || cachedData.length === 0) {
                return res.json({ success: false, error: 'No data available for this database.' });
            }
            const discovery = new DatabaseDiscovery(notionToken);
            const allDatabases = await discovery.discoverDatabases();
            const dbInfo = allDatabases.find(d => d.id === id);

            // --- Build Lookup Maps ---
            const allData = db.getAllData(); // Get data from ALL databases
            const lookupMap = new Map();
            const globalUserMap = new Map(); // Map Email -> Name

            Object.values(allData).flat().forEach(record => {
                // 1. Build Relation Map (ID -> Title)
                // Use explicit _title field from fetcher if available (Reliable!)
                let name = record._title;

                // Fallback to heuristic lookup if _title missing (legacy data)
                if (!name && record.properties) {
                    name = record.properties['Name'] || record.properties['Title'] || record.properties['Tên'];
                    if (!name) { // Last resort deep search
                        const lowerProps = Object.keys(record.properties).reduce((acc, key) => { acc[key.toLowerCase()] = record.properties[key]; return acc; }, {});
                        name = lowerProps['name'] ||
                            lowerProps['title'] ||
                            lowerProps['task name'] ||
                            lowerProps['sprint name'] ||
                            lowerProps['product name'] ||
                            lowerProps['project name'] ||
                            lowerProps['subject'] ||
                            lowerProps['item'] ||
                            lowerProps['content'] ||
                            lowerProps['summary'] ||
                            lowerProps['work'];
                    }
                }

                if (record.id) {
                    const id = record.id.toLowerCase();
                    if (name) {
                        if (typeof name !== 'string') name = String(name);
                        lookupMap.set(id, name);
                    } else {
                        // Add placeholder so we at least know the record exists
                        lookupMap.set(id, `[Untitled: ${record.id}]`);
                    }
                }

                // 2. Build User Map (Email -> Name)
                if (record.properties) {
                    Object.values(record.properties).forEach(val => {
                        // Check for array of users (e.g. Owner, Person)
                        if (Array.isArray(val)) {
                            val.forEach(item => {
                                if (item && typeof item === 'object') {
                                    if (item.email && item.name) {
                                        if (item.name !== item.email && item.name !== 'Unknown User') {
                                            globalUserMap.set(item.email.toLowerCase().trim(), item.name);
                                        }
                                    }
                                    // Also harvest users from "Created by" / "Last edited by"
                                    if (item.object === 'user' && item.name) {
                                        globalUserMap.set(item.name.toLowerCase(), item.name);
                                    }
                                }
                            });
                        }
                        // Check for single user object
                        else if (val && typeof val === 'object' && val.email && val.name) {
                            if (val.name !== val.email && val.name !== 'Unknown User') {
                                globalUserMap.set(val.email.toLowerCase().trim(), val.name);
                            }
                        }
                    });
                }
            });
            // --------------------------------------

            const columns = new Set();
            cachedData.forEach(record => {
                if (record.properties) Object.keys(record.properties).forEach(key => columns.add(key));
            });
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
            res.json({ success: true, message: 'Data refreshed successfully' });
        } catch (error) {
            console.error('[API] Refresh failed:', error);
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
        return value.map(v => formatValue(v, lookupMap, globalUserMap))
            .filter(v => v !== '') // Filter empty strings
            .join(', ');
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
