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
import { buildFreshnessContract } from '../utils/freshness.js';
import { loadSyncJobs, persistSyncJobs } from '../utils/sync-job-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// In-memory cache for database discovery
let databasesCache = null;
let databasesCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const RAW_FORMAT_CACHE_TTL_MS = parseInt(process.env.RAW_FORMAT_CACHE_TTL_MS || '120000', 10);
const RAW_RELATION_RESOLVE_MAX_ROWS = parseInt(process.env.RAW_RELATION_RESOLVE_MAX_ROWS || '400', 10);
const FULL_SYNC_CHECKPOINT_MS = parseInt(process.env.FULL_SYNC_CHECKPOINT_MS || `${6 * 60 * 60 * 1000}`, 10);
const rawFormatCache = new Map();

function getRawFormatCacheKey(databaseId, syncTime, options = {}) {
    return [
        databaseId,
        syncTime || 'no-sync-time',
        options.search || '',
        options.sortBy || '',
        options.sortDir || 'asc',
        options.page || 1,
        options.limit || 0,
        options.resolveRelations ? 'resolve' : 'noresolve'
    ].join('::');
}

function pruneRawFormatCache() {
    const now = Date.now();
    for (const [key, entry] of rawFormatCache.entries()) {
        if ((now - entry.createdAt) > RAW_FORMAT_CACHE_TTL_MS) {
            rawFormatCache.delete(key);
        }
    }
}

function parsePaginationParams(query) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limitRaw = parseInt(query.limit, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : null;
    const sortBy = typeof query.sort_by === 'string' ? query.sort_by : null;
    const sortDir = query.sort_dir === 'desc' ? 'desc' : 'asc';
    const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    const resolveRelations = query.resolve_relations !== 'false';
    return { page, limit, sortBy, sortDir, search, resolveRelations };
}

function applyRawFiltersAndPagination(rows, columns, options) {
    let filtered = rows;

    if (options.search) {
        filtered = rows.filter(row =>
            columns.some(col => String(row[col] ?? '').toLowerCase().includes(options.search))
        );
    }

    if (options.sortBy && columns.includes(options.sortBy)) {
        filtered = [...filtered].sort((a, b) => {
            const av = String(a[options.sortBy] ?? '');
            const bv = String(b[options.sortBy] ?? '');
            const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
            return options.sortDir === 'desc' ? -cmp : cmp;
        });
    }

    const totalFiltered = filtered.length;
    if (!options.limit) {
        return {
            data: filtered,
            pagination: {
                page: 1,
                limit: null,
                total_filtered: totalFiltered,
                total_pages: 1
            }
        };
    }

    const totalPages = Math.max(1, Math.ceil(totalFiltered / options.limit));
    const page = Math.min(options.page, totalPages);
    const offset = (page - 1) * options.limit;
    const pageData = filtered.slice(offset, offset + options.limit);

    return {
        data: pageData,
        pagination: {
            page,
            limit: options.limit,
            total_filtered: totalFiltered,
            total_pages: totalPages
        }
    };
}

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

function normalizeQuery(text = '') {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function extractFirstText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        const parts = value.map(extractFirstText).filter(Boolean);
        return parts.join(', ');
    }
    if (typeof value === 'object') {
        if (Array.isArray(value.people)) {
            const names = value.people
                .map(person => person?.name || person?.person?.email || '')
                .filter(Boolean);
            if (names.length > 0) return names.join(', ');
        }
        if (Array.isArray(value.relation)) {
            const rel = value.relation
                .map(item => item?.id || '')
                .filter(Boolean);
            if (rel.length > 0) return rel.join(', ');
        }
        if (value.type && value[value.type] !== undefined) {
            return extractFirstText(value[value.type]);
        }
        if (value.person && value.person.email) return String(value.person.email).trim();
        if (value.name) return String(value.name).trim();
        if (value.plain_text) return String(value.plain_text).trim();
        if (value.title && Array.isArray(value.title)) {
            return value.title.map(v => v?.plain_text || v?.text?.content || '').filter(Boolean).join('');
        }
        if (value.rich_text && Array.isArray(value.rich_text)) {
            return value.rich_text.map(v => v?.plain_text || v?.text?.content || '').filter(Boolean).join('');
        }
    }
    return '';
}

function extractAssigneeName(record) {
    if (!record || typeof record !== 'object') return '';
    const candidates = [
        'Assignee', 'Assignees', 'assigned_to',
        'Người phụ trách', 'Nguoi phu trach', 'Nhân sự', 'Nhan su',
        'Owner', 'People', 'Person', 'Người thực hiện', 'Nguoi thuc hien'
    ];
    for (const key of candidates) {
        if (record[key] !== undefined) {
            const value = extractFirstText(record[key]);
            if (value) return value;
        }
    }

    const props = (record.properties && typeof record.properties === 'object') ? record.properties : null;
    if (props) {
        for (const key of candidates) {
            if (props[key] !== undefined) {
                const value = extractFirstText(props[key]);
                if (value) return value;
            }
        }
        for (const [key, value] of Object.entries(props)) {
            const normalizedKey = normalizeQuery(key);
            if (
                normalizedKey.includes('assignee') ||
                normalizedKey.includes('owner') ||
                normalizedKey.includes('nguoi') ||
                normalizedKey.includes('nhan su') ||
                normalizedKey.includes('phu trach')
            ) {
                const text = extractFirstText(value);
                if (text) return text;
            }
        }
    }

    for (const [key, value] of Object.entries(record)) {
        const normalizedKey = normalizeQuery(key);
        if (normalizedKey.includes('assignee') || normalizedKey.includes('nguoi') || normalizedKey.includes('nhan su')) {
            const text = extractFirstText(value);
            if (text) return text;
        }
    }
    return '';
}

function extractAssigneeNames(record) {
    const raw = extractAssigneeName(record);
    if (!raw) return [];
    return raw
        .split(',')
        .map(item => item.trim())
        .filter(name =>
            name &&
            name.toLowerCase() !== 'unknown user' &&
            name.toLowerCase() !== 'unknown'
        );
}

function buildSmartCacheReply(userMessage, context, db) {
    const q = normalizeQuery(userMessage);
    if (!q) return null;

    const selectedFromContext = Array.isArray(context?.selected_database_ids) ? context.selected_database_ids : [];
    const selectedFromConfig = Array.isArray(db.getConfig('selected_databases')) ? db.getConfig('selected_databases') : [];
    const selectedIds = selectedFromContext.length > 0 ? selectedFromContext : selectedFromConfig;
    if (selectedIds.length === 0) return null;

    const rows = [];
    const dbNameMap = new Map();
    selectedIds.forEach(dbId => {
        const data = db.getData(dbId);
        if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            const dbName = first?.database_name || first?.project_name || dbId;
            dbNameMap.set(dbId, dbName);
            rows.push(...data);
        } else {
            dbNameMap.set(dbId, dbId);
        }
    });
    if (rows.length === 0) return null;

    const askTopAssignee =
        (q.includes('ai') && q.includes('nhieu') && q.includes('task')) ||
        q.includes('top assignee') ||
        q.includes('top nguoi');
    const askTotalTask = q.includes('bao nhieu task') || q.includes('tong task') || q.includes('so task');
    const askSyncTime = q.includes('sync luc nao') || q.includes('last sync') || q.includes('dong bo luc nao');

    if (askTopAssignee) {
        const byAssignee = new Map();
        rows.forEach(row => {
            const names = extractAssigneeNames(row);
            if (names.length === 0) return;
            names.forEach(name => {
                byAssignee.set(name, (byAssignee.get(name) || 0) + 1);
            });
        });
        const top = [...byAssignee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top.length === 0) {
            return 'Chua xac dinh duoc nguoi phu trach trong dung scope du an dang generate. Vui long kiem tra cot Assignee/Owner trong cac database da chon.';
        }
        const [topName, topCount] = top[0];
        const leaderboard = top.map(([name, count], i) => `${i + 1}. ${name}: ${count} task`).join('\n');
        return `Nguoi co nhieu task nhat hien tai: ${topName} (${topCount} task).\nTop 5:\n${leaderboard}`;
    }

    if (askTotalTask) {
        return `Tong task hien co trong cache cua cac database da chon: ${rows.length}.`;
    }

    if (askSyncTime) {
        const syncLines = selectedIds.slice(0, 5).map(dbId => {
            const syncAt = db.getLastSyncTime(dbId) || db.getLastUpdate() || 'khong ro';
            const dbName = dbNameMap.get(dbId) || dbId;
            return `- ${dbName}: ${syncAt}`;
        });
        return `Thoi gian dong bo gan nhat (toi da 5 database theo scope hien tai):\n${syncLines.join('\n')}`;
    }

    return null;
}

export function setupRoutes(app, db, poller) {
    const notionToken = process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN;
    const getChatRuntimeConfig = () => {
        const chatApiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.AL_API_KEY || '';
        const chatProvider = (process.env.AI_PROVIDER || (chatApiKey.startsWith('AIza') ? 'gemini' : 'openai')).toLowerCase();
        const defaultBase = chatProvider === 'gemini'
            ? 'https://generativelanguage.googleapis.com/v1beta'
            : 'https://api.openai.com/v1';
        return {
            chatbotEnabled: process.env.CHATBOT_ENABLED !== 'false',
            chatApiKey,
            chatProvider,
            chatBaseUrl: (process.env.AI_BASE_URL || defaultBase).replace(/\/$/, ''),
            chatModel: process.env.AI_MODEL || (chatProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini')
        };
    };
    let globalProjectsService = null;
    const rawWarmupInFlight = new Set();
    const syncJobsPath = path.join(__dirname, '..', '..', 'data', 'sync_jobs.json');
    const syncJobs = loadSyncJobs(syncJobsPath);
    const saveSyncJobs = () => persistSyncJobs(syncJobsPath, syncJobs);
    const relationNameCache = new Map(Object.entries(db.getMetadata('relation_name_cache') || {}));
    const persistRelationNameCache = () => {
        const toSave = {};
        relationNameCache.forEach((value, key) => {
            toSave[key] = value;
        });
        db.setMetadata('relation_name_cache', toSave);
    };

    const getProjectsService = () => {
        if (!notionToken) return null;
        if (!globalProjectsService) {
            globalProjectsService = new ProjectsService(notionToken);
        }
        return globalProjectsService;
    };

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

    const scheduleBackgroundCacheWarmup = (reason = 'manual') => {
        if (!poller || typeof poller.triggerPoll !== 'function') {
            return false;
        }

        setTimeout(async () => {
            try {
                console.log(`[API] Background cache warmup started (${reason})`);
                await poller.triggerPoll();
                db.buildLookupCache();
                console.log(`[API] Background cache warmup completed (${reason})`);
            } catch (error) {
                console.warn(`[API] Background cache warmup failed (${reason}):`, error.message);
            }
        }, 50);

        return true;
    };

    const scheduleRawDatabaseWarmup = (databaseId, reason = 'raw_checkpoint_due') => {
        if (!databaseId || rawWarmupInFlight.has(databaseId)) {
            return false;
        }
        if (!notionToken) {
            return false;
        }

        rawWarmupInFlight.add(databaseId);
        setTimeout(async () => {
            try {
                console.log(`[API] Background raw warmup started for ${databaseId} (${reason})`);
                const fetcher = new DataFetcher(notionToken, db);
                const result = await fetcher.fetchAllData([databaseId], null, {
                    fullSync: true,
                    fullSyncCheckpointMs: FULL_SYNC_CHECKPOINT_MS,
                    failOnDatabaseError: false
                });
                const rows = Array.isArray(result?.[databaseId]) ? result[databaseId] : null;
                if (rows) {
                    db.saveData(databaseId, rows);
                    rawFormatCache.clear();
                    console.log(`[API] Background raw warmup completed for ${databaseId}: ${rows.length} rows`);
                }
            } catch (error) {
                console.warn(`[API] Background raw warmup failed for ${databaseId}:`, error.message);
            } finally {
                rawWarmupInFlight.delete(databaseId);
            }
        }, 30);

        return true;
    };

    // ============ AUTH ROUTES ============
    app.get('/auth/status', (req, res) => {
        const configured = !!notionToken;
        const sessionAuthenticated = !!req.session?.configured;
        res.json({
            authenticated: configured, // Backward compatible for current UI
            configured,
            session_authenticated: sessionAuthenticated,
            auth_state: {
                token_configured: configured,
                session_authenticated: sessionAuthenticated
            },
            isAdmin: process.env.ADMIN_MODE === 'true' // Admin mode check
        });
    });

    app.post('/auth/setup', (req, res) => {
        if (!notionToken) return res.status(401).json({ error: 'No Notion token configured' });
        req.session.configured = true;
        res.json({ success: true, session_authenticated: true });
    });

    app.post('/auth/logout', (req, res) => {
        req.session.destroy();
        res.json({ success: true });
    });

    // ============ CHATBOT ROUTES ============
    app.get('/api/chat/config', (req, res) => {
        const { chatbotEnabled, chatProvider, chatModel, chatApiKey } = getChatRuntimeConfig();
        res.json({
            success: true,
            enabled: chatbotEnabled,
            provider: chatProvider,
            model: chatModel,
            provider_ready: Boolean(chatApiKey)
        });
    });

    app.post('/api/chat', async (req, res) => {
        const { chatbotEnabled, chatApiKey, chatProvider, chatBaseUrl, chatModel } = getChatRuntimeConfig();
        const userMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const context = (req.body?.context && typeof req.body.context === 'object') ? req.body.context : {};
        const history = Array.isArray(req.body?.history) ? req.body.history : [];

        if (!chatbotEnabled) {
            return res.status(403).json({
                success: false,
                error: 'Chatbot đang tắt (CHATBOT_ENABLED=false).'
            });
        }

        if (!userMessage) {
            return res.status(400).json({
                success: false,
                error: 'message là bắt buộc.'
            });
        }

        const safeHistory = history
            .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
            .slice(-8)
            .map(item => ({
                role: item.role,
                content: item.content.trim().slice(0, 3000)
            }));

        const selectedCount = context.selected_count || 'Chưa rõ';
        const reportType = context.report_type || 'chưa chọn';
        const pageTitle = context.page_title || 'Dashboard';
        const syncSource = context.sync_source || 'không rõ';

        const systemPrompt = [
            'Bạn là trợ lý cho dashboard Notion.',
            'Trả lời ngắn gọn, rõ ràng, bằng tiếng Việt.',
            'Nếu thiếu dữ liệu thì nêu rõ thiếu gì, không bịa.',
            'Ưu tiên hướng dẫn thao tác trực tiếp trên dashboard.'
        ].join(' ');

        const contextPrompt = `Ngữ cảnh hiện tại: page="${pageTitle}", report="${reportType}", selected="${selectedCount}", sync="${syncSource}".`;

        const smartReply = buildSmartCacheReply(userMessage, context, db);
        if (smartReply) {
            return res.json({
                success: true,
                reply: smartReply
            });
        }

        if (!chatApiKey) {
            return res.json({
                success: true,
                reply: `Preview mode: bạn hỏi "${userMessage}". Hiện chưa cấu hình AI_API_KEY/OPENAI_API_KEY nên bot đang chạy fallback. ${contextPrompt}`
            });
        }

        try {
            const useGemini = chatProvider === 'gemini' || chatApiKey.startsWith('AIza');
            if (useGemini) {
                const historyText = safeHistory
                    .map(item => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content}`)
                    .join('\n');
                const geminiBaseUrl = chatBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
                const requestedGeminiModel = String(chatModel || '').replace(/^models\//, '') || 'gemini-2.5-flash';
                const buildGeminiUrl = (modelName) =>
                    `${geminiBaseUrl}/models/${encodeURIComponent(String(modelName).replace(/^models\//, ''))}:generateContent?key=${encodeURIComponent(chatApiKey)}`;
                let geminiUrl = buildGeminiUrl(requestedGeminiModel);
                const geminiPrompt = [
                    systemPrompt,
                    contextPrompt,
                    historyText,
                    `User: ${userMessage}`
                ].filter(Boolean).join('\n\n');

                let geminiResponse = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [{ text: geminiPrompt }]
                            }
                        ],
                        generationConfig: {
                            temperature: 0.3,
                            maxOutputTokens: 500
                        }
                    }),
                    signal: AbortSignal.timeout(25000)
                });

                let geminiPayload = await geminiResponse.json();
                if (!geminiResponse.ok && geminiResponse.status === 404) {
                    try {
                        const listResponse = await fetch(`${geminiBaseUrl}/models?key=${encodeURIComponent(chatApiKey)}`, {
                            signal: AbortSignal.timeout(10000)
                        });
                        const listPayload = await listResponse.json();
                        const models = Array.isArray(listPayload?.models) ? listPayload.models : [];
                        const candidates = models.filter(model =>
                            Array.isArray(model?.supportedGenerationMethods) &&
                            model.supportedGenerationMethods.includes('generateContent')
                        );
                        const preferred = candidates.find(model => String(model?.baseModelId || '').startsWith('gemini-2.5-flash'))
                            || candidates.find(model => String(model?.baseModelId || '').includes('flash'))
                            || candidates[0];
                        const fallbackModel = preferred?.baseModelId || String(preferred?.name || '').replace(/^models\//, '');
                        if (fallbackModel) {
                            geminiUrl = buildGeminiUrl(fallbackModel);
                            geminiResponse = await fetch(geminiUrl, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    contents: [
                                        {
                                            parts: [{ text: geminiPrompt }]
                                        }
                                    ],
                                    generationConfig: {
                                        temperature: 0.3,
                                        maxOutputTokens: 500
                                    }
                                }),
                                signal: AbortSignal.timeout(25000)
                            });
                            geminiPayload = await geminiResponse.json();
                            if (geminiResponse.ok) {
                                const geminiReply = geminiPayload?.candidates?.[0]?.content?.parts
                                    ?.map(part => part?.text || '')
                                    .join('')
                                    .trim();
                                if (geminiReply) {
                                    return res.json({
                                        success: true,
                                        reply: geminiReply
                                    });
                                }
                            }
                        }
                    } catch {
                        // Keep original 404 error flow below.
                    }
                }
                if (!geminiResponse.ok) {
                    return res.status(geminiResponse.status).json({
                        success: false,
                        error: geminiPayload?.error?.message || geminiPayload?.error || 'Gemini request failed.'
                    });
                }

                const geminiReply = geminiPayload?.candidates?.[0]?.content?.parts
                    ?.map(part => part?.text || '')
                    .join('')
                    .trim();

                if (!geminiReply) {
                    return res.status(502).json({
                        success: false,
                        error: 'Gemini returned empty content.'
                    });
                }

                return res.json({
                    success: true,
                    reply: geminiReply
                });
            }

            const response = await fetch(`${chatBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${chatApiKey}`
                },
                body: JSON.stringify({
                    model: chatModel,
                    temperature: 0.3,
                    max_tokens: 500,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'system', content: contextPrompt },
                        ...safeHistory,
                        { role: 'user', content: userMessage }
                    ]
                }),
                signal: AbortSignal.timeout(25000)
            });

            const payload = await response.json();
            if (!response.ok) {
                return res.status(response.status).json({
                    success: false,
                    error: payload?.error?.message || payload?.error || 'AI provider request failed.'
                });
            }

            const reply = payload?.choices?.[0]?.message?.content;
            if (!reply || typeof reply !== 'string') {
                return res.status(502).json({
                    success: false,
                    error: 'AI provider trả về dữ liệu không hợp lệ.'
                });
            }

            return res.json({
                success: true,
                reply: reply.trim()
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: `Chat request failed: ${error.message}`
            });
        }
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
            rawFormatCache.clear();

            if (globalProjectsService && typeof globalProjectsService.refreshCache === 'function') {
                globalProjectsService.refreshCache().catch((error) => {
                    console.warn('[API] Projects cache refresh after whitelist update failed:', error.message);
                });
            }

            const warmupScheduled = scheduleBackgroundCacheWarmup(`whitelist_${action}`);

            res.json({
                success: true,
                action: action,
                projectCount: priorityData.projects.length,
                databaseCount: priorityData.priority_databases.length,
                warmup_scheduled: warmupScheduled
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
            req.session.configured = true;
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
        const projectsService = getProjectsService();
        if (!projectsService) return res.status(500).json({ error: 'Service not initialized' });

        const statusFilter = req.query.status || 'all';

        try {
            // Use Singleton's internal cache mechanism
            const projects = await projectsService.getProjectsTree({ statusFilter });
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
        const queryOptions = parsePaginationParams(req.query);

        try {
            const cachedData = db.getData(id);
            const hasCache = Array.isArray(cachedData);
            const { lookupMap, userMap: globalUserMap } = db.getLookupMaps();
            let databaseName = db.getDatabaseName(id) || null;

            const formatRows = async (records, syncedAt) => {
                const columns = new Set();
                records.forEach(record => {
                    if (record.properties) Object.keys(record.properties).forEach(key => columns.add(key));
                });
                const columnsArr = Array.from(columns);

                const cacheKey = getRawFormatCacheKey(id, syncedAt, queryOptions);
                const cachedFormat = rawFormatCache.get(cacheKey);
                if (cachedFormat && (Date.now() - cachedFormat.createdAt) <= RAW_FORMAT_CACHE_TTL_MS) {
                    return cachedFormat.payload;
                }

                const formattedRows = records.map(record => {
                    const row = {};
                    columnsArr.forEach(col => {
                        row[col] = formatValue(record.properties?.[col], lookupMap, globalUserMap);
                    });
                    return row;
                });

                let resolvedRows = formattedRows;
                const shouldResolveRelations = queryOptions.resolveRelations && records.length <= RAW_RELATION_RESOLVE_MAX_ROWS;
                if (shouldResolveRelations) {
                    resolvedRows = await resolveUnresolvedIds(
                        formattedRows,
                        lookupMap,
                        notionToken,
                        db,
                        relationNameCache
                    );
                    // Persist relation resolution cache lazily after successful enrichment
                    persistRelationNameCache();
                } else if (queryOptions.resolveRelations && records.length > RAW_RELATION_RESOLVE_MAX_ROWS) {
                    console.log(`[API] Skip relation resolution for ${id}: ${records.length} rows > ${RAW_RELATION_RESOLVE_MAX_ROWS}`);
                }

                const paged = applyRawFiltersAndPagination(resolvedRows, columnsArr, queryOptions);
                const payload = {
                    columns: columnsArr,
                    data: paged.data,
                    total_records: resolvedRows.length,
                    total_filtered: paged.pagination.total_filtered,
                    pagination: paged.pagination
                };

                rawFormatCache.set(cacheKey, {
                    createdAt: Date.now(),
                    payload
                });
                pruneRawFormatCache();

                return payload;
            };

            const respondFromRecords = async (records, freshness, extra = {}) => {
                const syncedAt = freshness.synced_at || db.getLastSyncTime(id) || db.getLastUpdate();
                const payload = await formatRows(records, syncedAt);

                return res.json({
                    success: true,
                    database_id: id,
                    database_name: databaseName || 'Unknown Database',
                    ...payload,
                    from_cache: freshness.data_source !== 'notion_api',
                    data_source: freshness.data_source,
                    stale_reason: freshness.stale_reason,
                    synced_at: freshness.synced_at,
                    freshness,
                    ...extra
                });
            };

            const checkpointDueForRaw = db.isFullSyncDue(id, FULL_SYNC_CHECKPOINT_MS);
            if (!forceRefresh && hasCache && cachedData.length > 0) {
                if (checkpointDueForRaw) {
                    const refreshScheduled = scheduleRawDatabaseWarmup(id, 'checkpoint_due');
                    console.log(
                        `[API] Returning cached data for ${id} (checkpoint due; background refresh ${refreshScheduled ? 'scheduled' : 'already running'})`
                    );
                    const freshness = buildFreshnessContract({
                        freshness_status: 'cached',
                        data_source: 'local_cache',
                        synced_at: db.getLastSyncTime(id) || db.getLastUpdate(),
                        stale_reason: refreshScheduled
                            ? 'checkpoint_due_background_refresh_scheduled'
                            : 'checkpoint_due_refresh_in_progress'
                    });
                    return await respondFromRecords(cachedData, freshness, {
                        checkpoint_due: true,
                        refresh_scheduled: refreshScheduled
                    });
                }

                console.log(`[API] Returning cached data for database ${id}`);
                const freshness = buildFreshnessContract({
                    freshness_status: 'cached',
                    data_source: 'local_cache',
                    synced_at: db.getLastSyncTime(id) || db.getLastUpdate()
                });
                return await respondFromRecords(cachedData, freshness);
            }

            console.log(`[API] Fetching fresh data for database ${id}...`);
            const fetcher = new DataFetcher(notionToken, db);
            const result = await fetcher.fetchAllData([id], null, {
                fullSync: true,
                fullSyncCheckpointMs: FULL_SYNC_CHECKPOINT_MS,
                failOnDatabaseError: true
            });
            const data = result[id] || [];

            db.saveData(id, data);
            databaseName = db.getDatabaseName(id) || databaseName;

            const freshness = buildFreshnessContract({
                freshness_status: data.length === 0 ? 'fresh_empty' : 'fresh',
                data_source: 'notion_api',
                synced_at: db.getLastSyncTime(id) || db.getLastUpdate()
            });
            return await respondFromRecords(data, freshness, { empty: data.length === 0 });
        } catch (error) {
            const fallbackData = db.getData(id);
            if (Array.isArray(fallbackData)) {
                console.warn(`[API] Fresh fetch failed for ${id}, serving fallback cache:`, error.message);
                const freshness = buildFreshnessContract({
                    freshness_status: 'fetch_failed_fallback_cache',
                    data_source: 'local_cache_fallback',
                    synced_at: db.getLastSyncTime(id) || db.getLastUpdate(),
                    stale_reason: error.message
                });

                const { lookupMap, userMap: globalUserMap } = db.getLookupMaps();
                const columns = new Set();
                fallbackData.forEach(record => {
                    if (record.properties) Object.keys(record.properties).forEach(key => columns.add(key));
                });
                const columnsArr = Array.from(columns);
                const formattedRows = fallbackData.map(record => {
                    const row = {};
                    columnsArr.forEach(col => {
                        row[col] = formatValue(record.properties?.[col], lookupMap, globalUserMap);
                    });
                    return row;
                });

                let resolvedRows = formattedRows;
                const shouldResolveRelations = queryOptions.resolveRelations && fallbackData.length <= RAW_RELATION_RESOLVE_MAX_ROWS;
                if (shouldResolveRelations) {
                    resolvedRows = await resolveUnresolvedIds(
                        formattedRows,
                        lookupMap,
                        notionToken,
                        db,
                        relationNameCache
                    );
                    persistRelationNameCache();
                } else if (queryOptions.resolveRelations && fallbackData.length > RAW_RELATION_RESOLVE_MAX_ROWS) {
                    console.log(`[API] Skip relation resolution for fallback ${id}: ${fallbackData.length} rows > ${RAW_RELATION_RESOLVE_MAX_ROWS}`);
                }

                const paged = applyRawFiltersAndPagination(resolvedRows, columnsArr, queryOptions);

                return res.status(200).json({
                    success: true,
                    database_id: id,
                    database_name: db.getDatabaseName(id) || 'Unknown Database',
                    columns: columnsArr,
                    data: paged.data,
                    total_records: resolvedRows.length,
                    total_filtered: paged.pagination.total_filtered,
                    pagination: paged.pagination,
                    from_cache: true,
                    data_source: freshness.data_source,
                    stale_reason: freshness.stale_reason,
                    synced_at: freshness.synced_at,
                    freshness
                });
            }

            console.error(`[API] Error fetching database ${id}:`, error);
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

            // Add freshness contract
            const lastUpdate = db.getLastUpdate();
            result.freshness = buildFreshnessContract({
                freshness_status: 'cached',
                data_source: 'local_cache',
                synced_at: lastUpdate
            });
            result.data_source = result.freshness.data_source;
            result.stale_reason = result.freshness.stale_reason;
            result.synced_at = result.freshness.synced_at;

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
                meta: { startDate, endDate },
                freshness: buildFreshnessContract({
                    freshness_status: 'cached',
                    data_source: 'local_cache',
                    synced_at: db.getLastUpdate()
                }),
                data_source: 'local_cache',
                stale_reason: null,
                synced_at: db.getLastUpdate()
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
            const selectedDatabases = db.getConfig('selected_databases') || [];
            const priorityData = loadPriorityProjects();
            const priorityDatabases = Array.isArray(priorityData.priority_databases) ? priorityData.priority_databases : [];
            const targetDatabases = [...new Set([...priorityDatabases, ...selectedDatabases])];
            const overview = await syncService.getOverview(targetDatabases);
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
            const mismatchThreshold = parseInt(process.env.SYNC_MISMATCH_THRESHOLD || '0', 10);
            const mismatchMeta = db.getMetadata('mismatch_tracker') || {};
            const prev = mismatchMeta[database_id] || { consecutive_over_threshold: 0 };
            const overThreshold = result.diff_count > mismatchThreshold;
            const consecutive = overThreshold ? (prev.consecutive_over_threshold || 0) + 1 : 0;
            mismatchMeta[database_id] = {
                last_checked_at: new Date().toISOString(),
                diff_count: result.diff_count,
                threshold: mismatchThreshold,
                over_threshold: overThreshold,
                consecutive_over_threshold: consecutive
            };
            db.setMetadata('mismatch_tracker', mismatchMeta);

            // Persist notion count for future reference
            db.setNotionCount(database_id, result.notion_count);

            // Get database name
            const dbInfo = await (new (await import('@notionhq/client')).Client({ auth: notionToken })).databases.retrieve({ database_id });
            const dbName = dbInfo.title?.[0]?.plain_text || 'Unknown';

            res.json({
                success: true,
                data: {
                    ...result,
                    database_name: dbName,
                    mismatch_tracker: mismatchMeta[database_id]
                }
            });
        } catch (error) {
            console.error(`[API] Sync check error for ${database_id}:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // Sync correctness summary (pass/fail criteria)
    app.get('/api/sync/correctness', requireAdmin, (req, res) => {
        try {
            const audit = db.getMetadata('sync_audit') || {};
            const fullSyncTimes = db.getMetadata('full_sync_times') || {};
            const mismatchTracker = db.getMetadata('mismatch_tracker') || {};
            const selectedDatabases = db.getConfig('selected_databases') || [];
            const priorityData = loadPriorityProjects();
            const priorityDatabases = Array.isArray(priorityData.priority_databases) ? priorityData.priority_databases : [];
            const targetDatabases = [...new Set([...priorityDatabases, ...selectedDatabases])];
            const targetDbSet = new Set(targetDatabases);
            const checkpointMs = FULL_SYNC_CHECKPOINT_MS;
            const mismatchConsecutiveLimit = parseInt(process.env.SYNC_MISMATCH_CONSECUTIVE_LIMIT || '2', 10);
            const staleCheckpointDbs = targetDatabases
                .filter((dbId) => db.isFullSyncDue(dbId, checkpointMs));

            const excessiveGrowth = Object.entries(audit)
                .filter(([dbId, info]) =>
                    targetDbSet.has(dbId) &&
                    Number(info.deleted || 0) === 0 &&
                    Number(info.new || 0) > 0 &&
                    info.mode === 'incremental_upsert'
                )
                .map(([dbId]) => dbId);

            const mismatchOverThreshold = Object.entries(mismatchTracker)
                .filter(([dbId, info]) =>
                    targetDbSet.has(dbId) &&
                    Number(info.consecutive_over_threshold || 0) >= mismatchConsecutiveLimit
                )
                .map(([dbId]) => dbId);

            const pass = staleCheckpointDbs.length === 0 && mismatchOverThreshold.length === 0;

            res.json({
                success: true,
                pass,
                criteria: {
                    full_sync_checkpoint_ms: checkpointMs,
                    mismatch_consecutive_limit: mismatchConsecutiveLimit,
                    target_databases_count: targetDatabases.length,
                    stale_checkpoint_count: staleCheckpointDbs.length,
                    suspicious_growth_count: excessiveGrowth.length,
                    mismatch_over_threshold_count: mismatchOverThreshold.length
                },
                stale_checkpoint_databases: staleCheckpointDbs,
                suspicious_growth_databases: excessiveGrowth,
                mismatch_over_threshold_databases: mismatchOverThreshold
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ============ SSE-BASED SYNC ALL ============
    // Persisted job storage (recovered on restart)
    pruneFinishedJobs(syncJobs, 10 * 60 * 1000);
    saveSyncJobs();

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
                max_age_minutes: max_age_minutes,
                timeout_ms: parseInt(process.env.SYNC_JOB_TIMEOUT_MS || `${30 * 60 * 1000}`, 10),
                retry_limit: parseInt(process.env.SYNC_JOB_RETRY_LIMIT || '1', 10),
                created_at: new Date().toISOString()
            });
            saveSyncJobs();

            // Start sync asynchronously (don't await)
            startSyncJob(jobId, db, notionToken, syncJobs, null, saveSyncJobs).catch(err => {
                console.error(`[API] Sync job ${jobId} failed:`, err);
                const job = syncJobs.get(jobId);
                if (job) {
                    job.status = 'error';
                    job.error = err.message;
                    saveSyncJobs();
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
                target_db: database_id,
                timeout_ms: parseInt(process.env.SYNC_JOB_TIMEOUT_MS || `${30 * 60 * 1000}`, 10),
                retry_limit: parseInt(process.env.SYNC_JOB_RETRY_LIMIT || '1', 10),
                created_at: new Date().toISOString()
            });
            saveSyncJobs();

            // Start sync asynchronously with targetDatabaseId
            startSyncJob(jobId, db, notionToken, syncJobs, database_id, saveSyncJobs).catch(err => {
                console.error(`[API] Single sync job ${jobId} failed:`, err);
                const job = syncJobs.get(jobId);
                if (job) {
                    job.status = 'error';
                    job.error = err.message;
                    saveSyncJobs();
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

            if (currentJob.status === 'running' || currentJob.status === 'retrying') {
                // Send progress update
                res.write(`data: ${JSON.stringify({
                    progress: currentJob.progress,
                    total: currentJob.total,
                    current_db: currentJob.current_db,
                    synced_databases: currentJob.synced_databases || []
                })}\n\n`);
            } else if (currentJob.status === 'complete' || currentJob.status === 'error' || currentJob.status === 'cancelled') {
                res.write(`event: ${currentJob.status}\ndata: ${JSON.stringify(currentJob)}\n\n`);
                clearInterval(interval);

                // Clean up job after 5 seconds
                setTimeout(() => {
                    syncJobs.delete(jobId);
                    console.log(`[API] Cleaned up job ${jobId}`);
                    saveSyncJobs();
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
        saveSyncJobs();

        console.log(`[API] 🛑 Sync job ${jobId} cancelled by user`);

        res.json({ success: true, message: 'Sync cancelled' });
    });

    // ============ STATUS ROUTES ============
    app.get('/api/status', (req, res) => {
        const lastUpdate = db.getLastUpdate();
        const selectedDatabases = db.getConfig('selected_databases') || [];
        const configured = !!notionToken;
        const sessionAuthenticated = !!req.session?.configured;
        res.json({
            success: true,
            status: 'running',
            last_update: lastUpdate,
            databases_count: selectedDatabases.length,
            authenticated: configured,
            configured,
            session_authenticated: sessionAuthenticated,
            effective_polling_interval_ms: poller?.effectiveIntervalMs || null
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
/**
 * Resolve any remaining UUIDs in formatted data by fetching page titles from Notion API.
 * Optimized with batching and shared client.
 */
async function resolveUnresolvedIds(formattedData, lookupMap, notionToken, dbManager = null, relationCache = new Map()) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const unresolvedIds = new Set();

    // 1. Collect unique unresolved IDs
    for (const row of formattedData) {
        for (const val of Object.values(row)) {
            if (typeof val === 'string' && val.length > 0) {
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

    const resolvedMap = new Map();

    // 1.5 Reuse persisted cache first to avoid extra Notion API calls
    for (const id of unresolvedIds) {
        const cachedName = relationCache.get(id) || relationCache.get(id.toLowerCase());
        if (cachedName) {
            resolvedMap.set(id, cachedName);
            lookupMap.set(id, cachedName);
        }
    }

    const remainingIds = Array.from(unresolvedIds).filter(id => !resolvedMap.has(id));
    if (remainingIds.length === 0) {
        // Apply cached resolutions and return
        for (const row of formattedData) {
            for (const [col, val] of Object.entries(row)) {
                if (typeof val !== 'string' || val.length === 0) continue;
                const parts = val.split(', ');
                const newParts = parts.map(part => {
                    const key = part.trim().toLowerCase();
                    return resolvedMap.get(key) || part;
                });
                row[col] = [...new Set(newParts)].join(', ');
            }
        }
        return formattedData;
    }

    // 2. Resolve in parallel with concurrency limit (e.g., 5 at a time to respect rate limits)
    console.log(`[API] 🔍 Resolving ${remainingIds.length}/${unresolvedIds.size} relation IDs (batch+cache)...`);

    // Use a shared Client if possible (cached at module level)
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: notionToken });

    const idsToResolve = remainingIds.slice(0, 50); // Hard limit per request for safety

    // Simple concurrency pool
    const CONCURRENCY = 5;
    for (let i = 0; i < idsToResolve.length; i += CONCURRENCY) {
        const batch = idsToResolve.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (id) => {
            try {
                const page = await notion.pages.retrieve({ page_id: id });
                let title = '';
                for (const [, prop] of Object.entries(page.properties || {})) {
                    if (prop.type === 'title' && prop.title) {
                        title = prop.title.map(t => t.plain_text).join('');
                        break;
                    }
                }
                const finalTitle = title || '[Untitled]';
                resolvedMap.set(id, finalTitle);
                lookupMap.set(id, finalTitle);
                relationCache.set(id, finalTitle);
            } catch (err) {
                console.warn(`[API] ⚠️ Failed to resolve ${id.substring(0, 8)}: ${err.message}`);
                // Don't add to lookupMap so we can retry later or leave as ID
            }
        }));
        // Small delay between batches to stay under rate limits
        if (i + CONCURRENCY < idsToResolve.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    // 3. Apply resolutions to data
    if (resolvedMap.size > 0) {
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
                        row[col] = [...new Set(newParts)].join(', ');
                    }
                }
            }
        }
        console.log(`[API] ✅ Resolved ${resolvedMap.size} IDs`);
    }

    if (dbManager && resolvedMap.size > 0) {
        const existing = dbManager.getMetadata('relation_name_cache') || {};
        const next = { ...existing };
        resolvedMap.forEach((name, id) => {
            next[id] = name;
        });
        dbManager.setMetadata('relation_name_cache', next);
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

function pruneFinishedJobs(syncJobsMap, maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [jobId, job] of syncJobsMap.entries()) {
        if (!['complete', 'error', 'cancelled'].includes(job.status)) continue;
        const finishedAt = job.finished_at ? new Date(job.finished_at).getTime() : now;
        if ((now - finishedAt) > maxAgeMs) {
            syncJobsMap.delete(jobId);
        }
    }
}

async function startSyncJob(jobId, db, notionToken, syncJobsMap, targetDatabaseId = null, persist = () => { }) {
    const job = syncJobsMap.get(jobId);
    if (!job) {
        console.error(`[SyncJob] Job ${jobId} not found`);
        return;
    }

    try {
        job.attempt = (job.attempt || 0) + 1;
        job.started_at = new Date().toISOString();

        const startedAtMs = Date.now();
        const shouldCancel = () => {
            const latestJob = syncJobsMap.get(jobId);
            if (!latestJob) return true;
            if (latestJob.cancelled || latestJob.status === 'cancelled') return true;

            if (latestJob.timeout_ms && latestJob.timeout_ms > 0) {
                if ((Date.now() - startedAtMs) > latestJob.timeout_ms) {
                    latestJob.status = 'error';
                    latestJob.error = `Sync job timed out after ${Math.round(latestJob.timeout_ms / 1000)}s`;
                    latestJob.finished_at = new Date().toISOString();
                    persist();
                    return true;
                }
            }
            return false;
        };

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
        persist();

        console.log(`[SyncJob ${jobId}] Starting sync for ${databaseIds.length} databases`);

        const { DataFetcher } = await import('../notion/fetcher.js');
        const fetcher = new DataFetcher(notionToken, db);

        let synced = 0;
        const onBatchComplete = (dbId, recordCount, syncMeta = {}) => {
            // Check if cancelled
            if (shouldCancel()) {
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
                sync_mode: syncMeta.mode || 'unknown',
                timestamp: new Date().toISOString()
            });

            job.results.push({ dbId, recordCount, ...syncMeta });
            console.log(`[SyncJob ${jobId}] ${synced}/${databaseIds.length} - ${dbId.substring(0, 8)}: ${recordCount} records`);
            persist();
        };
        // When targeting a single DB, use fullSync to ensure 100% accuracy (including deleted records removal)
        // When syncing all DBs (batch), use incremental for performance
        const syncOptions = targetDatabaseId
            ? { fullSync: true, shouldCancel, fullSyncCheckpointMs: FULL_SYNC_CHECKPOINT_MS }
            : { shouldCancel, fullSyncCheckpointMs: FULL_SYNC_CHECKPOINT_MS };
        await fetcher.fetchAllData(databaseIds, onBatchComplete, syncOptions);

        if (shouldCancel()) {
            throw new Error('Sync cancelled by user');
        }

        job.total_records = job.results.reduce((sum, r) => sum + r.recordCount, 0);
        job.status = 'complete';
        job.finished_at = new Date().toISOString();
        persist();

        console.log(`[SyncJob ${jobId}] ✅ Complete: ${synced} databases, ${job.total_records} records`);

    } catch (error) {
        console.error(`[SyncJob ${jobId}] ❌ Error:`, error);
        if (job.cancelled) {
            job.status = 'cancelled';
            job.error = null;
            job.finished_at = new Date().toISOString();
            persist();
            return;
        }

        const retryLimit = Number(job.retry_limit || 0);
        if (job.attempt <= retryLimit) {
            job.status = 'retrying';
            job.error = error.message;
            persist();
            return startSyncJob(jobId, db, notionToken, syncJobsMap, targetDatabaseId, persist);
        }

        job.status = 'error';
        job.error = error.message;
        job.finished_at = new Date().toISOString();
        persist();
    }
}


