import { NotionClient } from './client.js';
import debugLog from '../debug_logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Data Fetcher Service
 * Orchestrates fetching data from multiple databases
 */
export class DataFetcher {
    constructor(accessToken, db) {
        this.client = new NotionClient(accessToken);
        this.db = db;
        this.priorityDatabases = this.loadPriorityDatabases();
        debugLog('DataFetcher initialized');
    }

    /**
     * Load priority databases from config file
     * @returns {Array<string>} Array of priority database IDs
     */
    loadPriorityDatabases() {
        try {
            const priorityPath = path.join(__dirname, '..', '..', 'data', 'priority_projects.json');
            if (fs.existsSync(priorityPath)) {
                const data = JSON.parse(fs.readFileSync(priorityPath, 'utf8'));
                const priorities = data.priority_databases || [];
                console.log(`[Fetcher] 🌟 Loaded ${priorities.length} priority databases from whitelist`);
                return priorities;
            }
        } catch (error) {
            console.error('[Fetcher] Warning: Could not load priority_projects.json:', error.message);
        }
        return [];
    }

    /**
     * Sort database IDs with priority databases first
     * @param {Array<string>} databaseIds - Array of database IDs
     * @returns {Array<string>} Sorted array with priority DBs first
     */
    sortByPriority(databaseIds) {
        const prioritySet = new Set(this.priorityDatabases);
        const priorityList = [];
        const normalList = [];

        for (const dbId of databaseIds) {
            if (prioritySet.has(dbId)) {
                priorityList.push(dbId);
            } else {
                normalList.push(dbId);
            }
        }

        console.log(`[Fetcher] 📊 Priority order: ${priorityList.length} priority DBs first, then ${normalList.length} others`);
        return [...priorityList, ...normalList];
    }

    /**
     * Fetch data from all selected databases
     * @param {Array<string>} databaseIds - Array of database IDs to fetch
     * @returns {Promise<Object>} Object with database data keyed by ID
     */
    async fetchAllData(databaseIds) {
        // Sort databases by priority
        const sortedDatabaseIds = this.sortByPriority(databaseIds);
        
        console.log(`[Fetcher] Starting to fetch data from ${sortedDatabaseIds.length} databases...`);
        debugLog(`Fetching data from ${sortedDatabaseIds.length} databases`);

        const results = {};
        const dbMetadata = {};
        const prioritySet = new Set(this.priorityDatabases);

        // Helper sleep function
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // First, fetch database metadata to get names (Sequential)
        for (const dbId of sortedDatabaseIds) {
            try {
                const dbInfo = await this.client.notion.databases.retrieve({ database_id: dbId });
                dbMetadata[dbId] = this.extractDatabaseName(dbInfo);
                await sleep(200);
            } catch (error) {
                console.error(`[Fetcher] Error getting database name for ${dbId}:`, error.message);
                debugLog(`Error getting name for ${dbId}: ${error.message}`);
                dbMetadata[dbId] = 'Unknown Database';
            }
        }

        // Fetch data (Forced Full Sync)
        let priorityCount = 0;
        let normalCount = 0;
        
        for (const dbId of sortedDatabaseIds) {
            const isPriority = prioritySet.has(dbId);
            const icon = isPriority ? '🌟' : '📦';
            
            debugLog(`Processing database ${dbId} (${dbMetadata[dbId]})`);
            try {
                let filter = undefined;
                let lastSync = null;

                // Check for last sync time if DB manager is available
                if (this.db) {
                    lastSync = this.db.getLastSyncTime(dbId);
                    if (lastSync) {
                        // Use 24-hour safety buffer to be extremely safe against timezone/drift issues
                        // This fetches recent active tasks without reloading the entire history
                        const safetyBuffer = 24 * 60 * 60 * 1000;
                        const safeTime = new Date(new Date(lastSync).getTime() - safetyBuffer).toISOString();

                        const msg = `${icon} Incremental sync for ${dbId} (Window: 24h, Since: ${safeTime})`;
                        console.log(`[Fetcher] 🔄 ${msg}`);
                        debugLog(msg);

                        filter = {
                            property: "Last edited time",
                            date: {
                                after: safeTime
                            }
                        };
                    } else {
                        const msg = `${icon} Full sync for ${dbId} (First run)`;
                        console.log(`[Fetcher] ⬇️ ${msg}`);
                        debugLog(msg);
                    }
                } else {
                    debugLog(`Warning: no DB manager available for ${dbId}`);
                }


                const pages = await this.client.getAllPages(dbId, filter);
                debugLog(`Fetched ${pages.length} pages for ${dbId}`);

                // Logic check empty pages for incremental only applies when lastSync is set
                // Since we forced lastSync = null via comment, this block is skipped or safe

                const databaseName = dbMetadata[dbId];
                const projectName = this.extractProjectName(databaseName);

                const transformed = pages.map(page => ({
                    ...this.transformPage(page),
                    database_name: databaseName,
                    project_name: projectName,
                    database_id: dbId
                }));

                results[dbId] = transformed;

                const priorityLabel = isPriority ? '🌟 PRIORITY' : '';
                const successMsg = `Database ${dbId.substring(0, 8)}... (${databaseName}): ${transformed.length} records ${priorityLabel}`;
                console.log(`[Fetcher] ✅ ${successMsg}`);
                debugLog(successMsg);
                
                if (isPriority) {
                    priorityCount++;
                } else {
                    normalCount++;
                }

                await sleep(350);
            } catch (error) {
                console.error(`[Fetcher] ❌ Failed to fetch database ${dbId}:`, error.message);
                debugLog(`Failed to fetch ${dbId}: ${error.message}`);
                results[dbId] = [];
            }
        }

        const totalRecords = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[Fetcher] ✅ Sync complete: ${totalRecords} total records (🌟 ${priorityCount} priority, 📦 ${normalCount} normal databases)`);
        debugLog(`Total records fetched: ${totalRecords}`);

        return results;
    }

    extractDatabaseName(database) {
        if (database.title && database.title.length > 0) {
            return database.title[0].plain_text || 'Untitled Database';
        }
        return 'Untitled Database';
    }

    /**
     * Extract project name from database name by removing suffix
     * @param {string} databaseName - Full database name
     * @returns {string} Project name without suffix
     */
    extractProjectName(databaseName) {
        // Patterns to remove: " - Product", " - Task", " - Sprint", "_Product", etc.
        const patterns = [
            / - Product$/i,
            / - Task$/i,
            / - Sprint$/i,
            /_Product$/i,
            /_Task$/i,
            /_Sprint$/i,
            /Product$/i,
            /Task$/i,
            /Sprint$/i
        ];

        let projectName = databaseName;
        for (const pattern of patterns) {
            projectName = projectName.replace(pattern, '').trim();
        }

        // Remove trailing dash or underscore if any
        projectName = projectName.replace(/[-_\s]+$/, '').trim();

        return projectName || databaseName;
    }

    /**
     * Transform Notion page to simplified format
     * @param {Object} page - Notion page object
     * @returns {Object} Simplified page data
     */
    transformPage(page) {
        const transformed = {
            id: page.id,
            created_time: page.created_time,
            last_edited_time: page.last_edited_time,
            properties: {}
        };

        // Transform properties to simple key-value pairs
        for (const [key, prop] of Object.entries(page.properties)) {
            const value = this.extractPropertyValue(prop);
            transformed.properties[key] = value;

            // Store explicit title for lookup reliability
            if (prop.type === 'title') {
                transformed._title = value;
            }
        }

        return transformed;
    }

    /**
     * Extract value from Notion property based on type
     * @param {Object} property - Notion property object
     * @returns {any} Extracted value
     */
    extractPropertyValue(property) {
        const type = property.type;

        switch (type) {
            case 'title':
                return property.title?.map(t => t.plain_text).join('') || '';

            case 'rich_text':
                return property.rich_text?.map(t => t.plain_text).join('') || '';

            case 'number':
                return property.number;

            case 'select':
                return property.select?.name || null;

            case 'multi_select':
                return property.multi_select?.map(s => s.name) || [];

            case 'date':
                return property.date ? {
                    start: property.date.start,
                    end: property.date.end
                } : null;

            case 'people':
                return property.people?.map(p => ({
                    id: p.id,
                    name: p.name || p.person?.email || 'Unknown User',
                    email: p.person?.email || null
                })) || [];

            case 'checkbox':
                return property.checkbox;

            case 'url':
                return property.url;

            case 'email':
                return property.email;

            case 'phone_number':
                return property.phone_number;

            case 'status':
                return property.status?.name || null;

            case 'relation':
                return property.relation?.map(r => r.id) || [];

            case 'formula':
                return this.extractFormulaValue(property.formula);

            case 'rollup':
                return this.extractRollupValue(property.rollup);

            default:
                return null;
        }
    }

    /**
     * Extract value from formula property
     */
    extractFormulaValue(formula) {
        if (!formula) return null;

        switch (formula.type) {
            case 'string':
                return formula.string;
            case 'number':
                return formula.number;
            case 'boolean':
                return formula.boolean;
            case 'date':
                return formula.date;
            default:
                return null;
        }
    }

    /**
     * Extract value from rollup property
     */
    extractRollupValue(rollup) {
        if (!rollup) return null;

        switch (rollup.type) {
            case 'number':
                return rollup.number;
            case 'array':
                // Process array items to extract meaningful values
                if (!rollup.array || rollup.array.length === 0) return null;
                
                return rollup.array.map(item => {
                    if (!item) return null;
                    
                    // Title type (from relation title rollup)
                    if (item.type === 'title' && item.title) {
                        return item.title.map(t => t.plain_text || '').join('');
                    }
                    // Rich text
                    if (item.type === 'rich_text' && item.rich_text) {
                        return item.rich_text.map(t => t.plain_text || '').join('');
                    }
                    // Select/Status
                    if (item.type === 'select' && item.select) {
                        return item.select.name;
                    }
                    if (item.type === 'status' && item.status) {
                        return item.status.name;
                    }
                    // Number
                    if (item.type === 'number') {
                        return item.number;
                    }
                    // Date
                    if (item.type === 'date' && item.date) {
                        return item.date.start || item.date.end;
                    }
                    // Formula
                    if (item.type === 'formula' && item.formula) {
                        return item.formula.string ?? item.formula.number ?? item.formula.boolean ?? null;
                    }
                    
                    return item;
                }).filter(v => v !== null);
            default:
                return null;
        }
    }
}
