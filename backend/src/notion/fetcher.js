import { NotionClient } from './client.js';
import debugLog from '../debug_logger.js';

/**
 * Data Fetcher Service
 * Orchestrates fetching data from multiple databases
 */
export class DataFetcher {
    constructor(accessToken, db) {
        this.client = new NotionClient(accessToken);
        this.db = db;
        debugLog('DataFetcher initialized');
    }

    /**
     * Fetch data from all selected databases
     * @param {Array<string>} databaseIds - Array of database IDs to fetch
     * @returns {Promise<Object>} Object with database data keyed by ID
     */
    async fetchAllData(databaseIds) {
        console.log(`[Fetcher] Starting to fetch data from ${databaseIds.length} databases...`);
        debugLog(`Fetching data from ${databaseIds.length} databases`);

        const results = {};
        const dbMetadata = {};

        // Helper sleep function
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // First, fetch database metadata to get names (Sequential)
        for (const dbId of databaseIds) {
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
        for (const dbId of databaseIds) {
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

                        const msg = `Incremental sync for ${dbId} (Window: 24h, Since: ${safeTime})`;
                        console.log(`[Fetcher] 🔄 ${msg}`);
                        debugLog(msg);

                        filter = {
                            property: "Last edited time",
                            date: {
                                after: safeTime
                            }
                        };
                    } else {
                        const msg = `Full sync for ${dbId} (First run)`;
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

                const type = 'Total';
                const successMsg = `Database ${dbId.substring(0, 8)}... (${databaseName}): ${transformed.length} ${type} records`;
                console.log(`[Fetcher] ✅ ${successMsg}`);
                debugLog(successMsg);

                await sleep(350);
            } catch (error) {
                console.error(`[Fetcher] ❌ Failed to fetch database ${dbId}:`, error.message);
                debugLog(`Failed to fetch ${dbId}: ${error.message}`);
                results[dbId] = [];
            }
        }

        const totalRecords = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[Fetcher] ✅ Total fetched records: ${totalRecords}`);
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
                return rollup.array;
            default:
                return null;
        }
    }
}
