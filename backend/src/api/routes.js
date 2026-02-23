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
import { SyncService } from '../notion/sync.js';
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
            configured: !!notionToken,
            isAdmin: process.env.ADMIN_MODE === 'true' // Admin mode check
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
        const forceRefresh = req.query.refresh === 'true';
        const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — cache is considered fresh within this window
        try {
            let cachedData = null;
            let fromCache = false;

            // Smart cache strategy:
            // 1. If forceRefresh → always fetch fresh
            // 2. If cache exists and is < CACHE_MAX_AGE → use cache (fast!)
            // 3. If cache is old or missing → fetch fresh from Notion (realtime)
            if (!forceRefresh) {
                const lastSync = db.getLastSyncTime(id);
                if (lastSync) {
                    const cacheAge = Date.now() - new Date(lastSync).getTime();
                    if (cacheAge < CACHE_MAX_AGE_MS) {
                        cachedData = db.getData(id);
                        if (cachedData && cachedData.length > 0) {
                            fromCache = true;
                            const ageMin = Math.round(cacheAge / 60000);
                            console.log(`[API] Serving ${cachedData.length} cached records for ${id} (synced ${ageMin}min ago, fresh)`);
                        }
                    } else {
                        const ageMin = Math.round((Date.now() - new Date(lastSync).getTime()) / 60000);
                        console.log(`[API] Cache stale for ${id} (${ageMin}min old > ${CACHE_MAX_AGE_MS / 60000}min), fetching fresh...`);
                    }
                }
            }

            // Fetch fresh from Notion if no cached data or not cache-first
            if (!cachedData || cachedData.length === 0) {
                console.log(`[API] Raw data fetching FRESH from Notion for ${id} (Force: ${forceRefresh})...`);
                try {
                    const fetcher = new DataFetcher(notionToken);
                    const result = await fetcher.fetchAllData([id], null, { fullSync: true });
                    const freshData = result[id] || [];

                    if (freshData.length > 0) {
                        // Use saveData (OVERWRITE) — not upsertData — to ensure deleted records are removed
                        db.saveData(id, freshData);
                        cachedData = freshData;
                        fromCache = false;
                        console.log(`[API] ✅ Fetched and saved ${freshData.length} records for ${id}`);
                    } else {
                        // Notion returned 0 records — might be empty DB or error
                        // Try fallback to cache if available
                        console.warn(`[API] ⚠️ Notion returned 0 records for ${id}, falling back to cache`);
                        cachedData = db.getData(id);
                        fromCache = true;
                    }
                } catch (fetchError) {
                    console.error(`[API] ❌ Failed to fetch from Notion for ${id}:`, fetchError.message);
                    // Fallback to cache
                    cachedData = db.getData(id);
                    fromCache = true;
                    if (cachedData && cachedData.length > 0) {
                        console.log(`[API] Using fallback cache: ${cachedData.length} records`);
                    }
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

            // Resolve any remaining UUIDs (relation/rollup IDs from unsynced databases)
            await resolveUnresolvedIds(formattedData, lookupMap, notionToken, db);

            res.json({
                success: true,
                database_id: id,
                database_name: dbInfo?.name || 'Unknown Database',
                columns: Array.from(columns),
                data: formattedData,
                total_records: formattedData.length,
                from_cache: fromCache,
                synced_at: fromCache ? (db.getLastSyncTime(id) || new Date().toISOString()) : new Date().toISOString()
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

            const { validData, unknownUsers, filterStats } = await prodService.generateReport(startDate, endDate, selectedDatabases);
            const stats = prodService.getStats(startDate, endDate);

            res.json({
                success: true,
                columns: PROD_COLUMNS,
                data: validData,
                unknownUsers,
                filterStats,
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

    // ============ SYNC MONITOR ROUTES (Admin Only) ============
    // Middleware: Require admin mode
    const requireAdmin = (req, res, next) => {
        if (process.env.ADMIN_MODE !== 'true') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }
        next();
    };

    // Get sync overview
    app.get('/api/sync/overview', requireAdmin, async (req, res) => {
        try {
            const syncService = new SyncService(new (await import('@notionhq/client')).Client({ auth: notionToken }), db);
            const overview = await syncService.getOverview();
            res.json({ success: true, data: overview });
        } catch (error) {
            console.error('[API] Sync overview error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Check sync for specific database
    app.post('/api/sync/check', requireAdmin, async (req, res) => {
        const { database_id } = req.body;
        if (!database_id) {
            return res.status(400).json({ error: 'database_id is required' });
        }

        try {
            const syncService = new SyncService(new (await import('@notionhq/client')).Client({ auth: notionToken }), db);
            const result = await syncService.checkDatabase(database_id);

            // Persist notion count for future reference
            db.setNotionCount(database_id, result.notion_count);

            // Get database name
            const dbInfo = await (new (await import('@notionhq/client')).Client({ auth: notionToken })).databases.retrieve({ database_id });
            const dbName = dbInfo.title?.[0]?.plain_text || 'Unknown';

            res.json({
                success: true,
                data: {
                    ...result,
                    database_name: dbName
                }
            });
        } catch (error) {
            console.error(`[API] Sync check error for ${database_id}:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============ SSE-BASED SYNC ALL ============
    // In-memory job storage
    const syncJobs = new Map();

    // Start sync job
    app.post('/api/sync/start', requireAdmin, async (req, res) => {
        try {
            const { resume = false, max_age_minutes = 10 } = req.body;
            const jobId = Date.now().toString();
            console.log(`[API] Starting sync job ${jobId} (resume: ${resume}, max_age: ${max_age_minutes}min)`);

            syncJobs.set(jobId, {
                progress: 0,
                total: 0,
                status: 'starting',
                results: [],
                synced_databases: [],
                current_db: null,
                resume_mode: resume,
                max_age_minutes: max_age_minutes
            });

            // Start sync asynchronously (don't await)
            startSyncJob(jobId, db, notionToken, syncJobs).catch(err => {
                console.error(`[API] Sync job ${jobId} failed:`, err);
                const job = syncJobs.get(jobId);
                if (job) {
                    job.status = 'error';
                    job.error = err.message;
                }
            });

            res.json({ success: true, job_id: jobId });
        } catch (error) {
            console.error('[API] Error starting sync job:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Start single database sync
    app.post('/api/sync/single', requireAdmin, async (req, res) => {
        try {
            const { database_id } = req.body;
            if (!database_id) return res.status(400).json({ error: 'database_id is required' });

            const jobId = Date.now().toString();
            console.log(`[API] Starting single sync job ${jobId} for ${database_id}`);

            syncJobs.set(jobId, {
                progress: 0,
                total: 1,
                status: 'starting',
                results: [],
                synced_databases: [],
                current_db: null,
                resume_mode: false,
                single_mode: true, // Flag for UI
                target_db: database_id
            });

            // Start sync asynchronously with targetDatabaseId
            startSyncJob(jobId, db, notionToken, syncJobs, database_id).catch(err => {
                console.error(`[API] Single sync job ${jobId} failed:`, err);
                const job = syncJobs.get(jobId);
                if (job) {
                    job.status = 'error';
                    job.error = err.message;
                }
            });

            res.json({ success: true, job_id: jobId });
        } catch (error) {
            console.error('[API] Error starting single sync job:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // SSE stream for sync progress
    app.get('/api/sync/stream/:jobId', requireAdmin, (req, res) => {
        const { jobId } = req.params;
        const job = syncJobs.get(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        console.log(`[API] SSE stream opened for job ${jobId}`);

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

        // Send initial state
        res.write(`data: ${JSON.stringify(job)}\n\n`);

        // Poll for updates every 500ms
        const interval = setInterval(() => {
            const currentJob = syncJobs.get(jobId);

            if (!currentJob) {
                clearInterval(interval);
                res.end();
                return;
            }

            if (currentJob.status === 'running') {
                // Send progress update
                res.write(`data: ${JSON.stringify({
                    progress: currentJob.progress,
                    total: currentJob.total,
                    current_db: currentJob.current_db,
                    synced_databases: currentJob.synced_databases || []
                })}\n\n`);
            } else if (currentJob.status === 'complete' || currentJob.status === 'error') {
                res.write(`event: ${currentJob.status}\ndata: ${JSON.stringify(currentJob)}\n\n`);
                clearInterval(interval);

                // Clean up job after 5 seconds
                setTimeout(() => {
                    syncJobs.delete(jobId);
                    console.log(`[API] Cleaned up job ${jobId}`);
                }, 5000);

                res.end();
            }
        }, 500);

        // Clean up on client disconnect
        req.on('close', () => {
            console.log(`[API] SSE stream closed for job ${jobId}`);
            clearInterval(interval);
        });
    });

    // Abort sync job
    app.post('/api/sync/abort/:jobId', requireAdmin, (req, res) => {
        const { jobId } = req.params;
        const job = syncJobs.get(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        job.status = 'cancelled';
        job.cancelled = true;

        console.log(`[API] 🛑 Sync job ${jobId} cancelled by user`);

        res.json({ success: true, message: 'Sync cancelled' });
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
            return res.status(503).json({ error: 'Polling service not available' });
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
 * Resolve any remaining UUIDs in formatted data by fetching page titles from Notion API.
 * This handles relation/rollup IDs that are not in the lookupMap (e.g., pages from unsynced databases).
 * @param {Array} formattedData - Array of formatted row objects
 * @param {Map} lookupMap - The existing lookup map (will be updated with new resolutions)
 * @param {string} notionToken - Notion API token
 * @param {Object} dbManager - DatabaseManager instance to persist resolved names
 * @returns {Promise<Array>} Updated formattedData with IDs replaced by names
 */
async function resolveUnresolvedIds(formattedData, lookupMap, notionToken, dbManager = null) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const unresolvedIds = new Set();

    // Scan all values for remaining UUIDs
    for (const row of formattedData) {
        for (const val of Object.values(row)) {
            if (typeof val === 'string' && val.length > 0) {
                // Check each comma-separated part (relations can be "id1, id2")
                const parts = val.split(', ');
                for (const part of parts) {
                    const trimmed = part.trim();
                    if (uuidRegex.test(trimmed) && !lookupMap.has(trimmed.toLowerCase())) {
                        unresolvedIds.add(trimmed.toLowerCase());
                    }
                }
            }
        }
    }

    if (unresolvedIds.size === 0) return formattedData;

    console.log(`[API] 🔍 Found ${unresolvedIds.size} unresolved relation IDs, fetching from Notion...`);

    // Limit to 50 to avoid API overload
    const idsToResolve = Array.from(unresolvedIds).slice(0, 50);
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: notionToken });
    const resolvedMap = new Map();

    for (const id of idsToResolve) {
        try {
            const page = await notion.pages.retrieve({ page_id: id });
            // Extract title from page properties
            let title = '';
            for (const [, prop] of Object.entries(page.properties || {})) {
                if (prop.type === 'title' && prop.title) {
                    title = prop.title.map(t => t.plain_text).join('');
                    break;
                }
            }
            if (title) {
                resolvedMap.set(id, title);
                lookupMap.set(id, title); // Update in-memory cache for future requests
            } else {
                // Page exists but has no title — use "Untitled"
                resolvedMap.set(id, '[Untitled]');
                lookupMap.set(id, '[Untitled]');
            }
        } catch (err) {
            // Page may have been deleted or no access
            console.warn(`[API] ⚠️ Could not resolve page ${id.substring(0, 8)}...: ${err.message}`);
        }
        // Rate limiting: 100ms between requests
        await new Promise(r => setTimeout(r, 100));
    }

    if (resolvedMap.size > 0) {
        console.log(`[API] ✅ Resolved ${resolvedMap.size}/${idsToResolve.length} relation IDs to names`);

        // Replace UUIDs in formatted data with resolved names
        for (const row of formattedData) {
            for (const [col, val] of Object.entries(row)) {
                if (typeof val === 'string' && val.length > 0) {
                    const parts = val.split(', ');
                    let changed = false;
                    const newParts = parts.map(part => {
                        const trimmed = part.trim().toLowerCase();
                        if (resolvedMap.has(trimmed)) {
                            changed = true;
                            return resolvedMap.get(trimmed);
                        }
                        return part;
                    });
                    if (changed) {
                        row[col] = [...new Set(newParts)].join(', '); // Dedupe
                    }
                }
            }
        }
    }

    if (unresolvedIds.size > 50) {
        console.warn(`[API] ⚠️ ${unresolvedIds.size - 50} IDs skipped (limit 50 per request)`);
    }

    return formattedData;
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

    // UUID regex check — supports both dashed (standard) and dashless (Notion relation) formats
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strVal);
    const isDashlessUUID = !isUUID && /^[0-9a-f]{32}$/i.test(strVal);

    if (isUUID) {
        const id = strVal.toLowerCase();
        if (lookupMap.has(id)) {
            return lookupMap.get(id);
        }
    }

    // Handle dashless UUIDs: normalize to dashed format (8-4-4-4-12) and try lookup
    if (isDashlessUUID) {
        const raw = strVal.toLowerCase();
        const dashed = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
        if (lookupMap.has(dashed)) {
            return lookupMap.get(dashed);
        }
        // Also try raw dashless in case lookupMap has it that way
        if (lookupMap.has(raw)) {
            return lookupMap.get(raw);
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

// ============ SSE SYNC JOB HANDLER ============

async function startSyncJob(jobId, db, notionToken, syncJobsMap, targetDatabaseId = null) {
    const job = syncJobsMap.get(jobId);
    if (!job) {
        console.error(`[SyncJob] Job ${jobId} not found`);
        return;
    }

    try {
        let databaseIds = [];

        if (targetDatabaseId) {
            // Single database sync mode
            databaseIds = [targetDatabaseId];
            console.log(`[SyncJob ${jobId}] Target specific database: ${targetDatabaseId}`);
        } else {
            // Sync all databases
            const stats = db.getStats();
            databaseIds = stats.cacheFiles.map(f => f.id);
        }

        // Filter out recently synced databases if resume mode
        if (job.resume_mode) {
            const cutoffTime = Date.now() - (job.max_age_minutes * 60 * 1000);
            const originalCount = databaseIds.length;

            databaseIds = databaseIds.filter(dbId => {
                const lastSync = db.getLastSyncTime(dbId);
                if (!lastSync) return true; // Never synced, include

                const syncTime = new Date(lastSync).getTime();
                const ageMinutes = Math.round((Date.now() - syncTime) / 60000);
                const shouldSync = syncTime < cutoffTime;

                if (!shouldSync) {
                    console.log(`[SyncJob ${jobId}] ⏭️  Skipping ${dbId.substring(0, 8)} (synced ${ageMinutes}min ago)`);
                }

                return shouldSync;
            });

            const skippedCount = originalCount - databaseIds.length;
            console.log(`[SyncJob ${jobId}] Resume mode: ${databaseIds.length} databases to sync, ${skippedCount} skipped (synced < ${job.max_age_minutes}min ago)`);
        }

        job.total = databaseIds.length;
        job.status = 'running';

        console.log(`[SyncJob ${jobId}] Starting sync for ${databaseIds.length} databases`);

        const { DataFetcher } = await import('../notion/fetcher.js');
        const fetcher = new DataFetcher(notionToken, db);

        let synced = 0;
        const onBatchComplete = (dbId, recordCount) => {
            // Check if cancelled
            if (job.cancelled) {
                throw new Error('Sync cancelled by user');
            }

            synced++;
            job.progress = synced;
            job.current_db = dbId.substring(0, 8);

            // Track synced database with details
            job.synced_databases.push({
                id: dbId,
                short_id: dbId.substring(0, 8),
                records: recordCount,
                timestamp: new Date().toISOString()
            });

            job.results.push({ dbId, recordCount });
            console.log(`[SyncJob ${jobId}] ${synced}/${databaseIds.length} - ${dbId.substring(0, 8)}: ${recordCount} records`);
        };
        // When targeting a single DB, use fullSync to ensure 100% accuracy (including deleted records removal)
        // When syncing all DBs (batch), use incremental for performance
        const syncOptions = targetDatabaseId ? { fullSync: true } : {};
        await fetcher.fetchAllData(databaseIds, onBatchComplete, syncOptions);

        job.total_records = job.results.reduce((sum, r) => sum + r.recordCount, 0);
        job.status = 'complete';

        console.log(`[SyncJob ${jobId}] ✅ Complete: ${synced} databases, ${job.total_records} records`);

    } catch (error) {
        console.error(`[SyncJob ${jobId}] ❌ Error:`, error);
        job.status = 'error';
        job.error = error.message;
    }
}

