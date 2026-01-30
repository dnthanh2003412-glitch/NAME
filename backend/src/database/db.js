import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import debugLog from '../debug_logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * JSON File Database Manager
 * Simple file-based storage - no SQLite build tools needed
 */
export class DatabaseManager {
    constructor(dbPath = null) {
        // Use custom path or default to data/cache.json
        const defaultPath = join(__dirname, '..', '..', 'data', 'cache.json');
        this.dbPath = dbPath || process.env.DB_PATH || defaultPath;

        // Ensure data directory exists
        const dataDir = dirname(this.dbPath);
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true });
        }

        // Initialize empty database if doesn't exist
        if (!existsSync(this.dbPath)) {
            this.writeData({
                config: {},
                data_cache: {},
                metadata: {}
            });
        }

        console.log(`[Database] Initialized at ${this.dbPath}`);
    }

    /**
     * Read entire database
     */
    readData() {
        try {
            const content = readFileSync(this.dbPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('[Database] Error reading:', error);
            debugLog(`Error reading database: ${error.message}`);
            return { config: {}, data_cache: {}, metadata: {} };
        }
    }

    /**
     * Write entire database
     */
    writeData(data) {
        try {
            debugLog('Writing data to disk...');
            writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf8');
            debugLog('Data written successfully');
        } catch (error) {
            console.error('[Database] Error writing:', error);
            debugLog(`[Database] Error writing: ${error.message}`);
        }
    }

    /**
     * Save data from a database (overwrite)
     * @param {string} databaseId
     * @param {Array} records
     */
    saveData(databaseId, records) {
        const db = this.readData();

        if (!db.data_cache) {
            db.data_cache = {};
        }

        db.data_cache[databaseId] = records;

        // Update metadata
        if (!db.metadata) db.metadata = {};
        db.metadata.last_refresh = new Date().toISOString();

        // Update per-database sync time
        if (!db.metadata.sync_times) db.metadata.sync_times = {};
        db.metadata.sync_times[databaseId] = new Date().toISOString();

        this.writeData(db);

        console.log(`[Database] ✅ Saved ${records.length} records for database ${databaseId}`);
    }

    /**
     * Upsert data (merge new records with existing)
     * @param {string} databaseId 
     * @param {Array} newRecords 
     */
    upsertData(databaseId, newRecords) {
        if (!newRecords || newRecords.length === 0) {
            debugLog(`Upsert skipped for ${databaseId}: No new records`);
            return;
        }

        debugLog(`Upserting ${newRecords.length} records for ${databaseId}`);

        const db = this.readData();
        if (!db.data_cache) db.data_cache = {};

        const existingData = db.data_cache[databaseId] || [];
        const existingMap = new Map(existingData.map(r => [r.id, r]));

        // Update or add new records
        let newCount = 0;
        let updateCount = 0;

        newRecords.forEach(record => {
            if (existingMap.has(record.id)) {
                updateCount++;
            } else {
                newCount++;
            }
            existingMap.set(record.id, record);
        });

        // Convert back to array
        db.data_cache[databaseId] = Array.from(existingMap.values());

        // Update metadata
        if (!db.metadata) db.metadata = {};
        db.metadata.last_refresh = new Date().toISOString();

        if (!db.metadata.sync_times) db.metadata.sync_times = {};
        db.metadata.sync_times[databaseId] = new Date().toISOString();

        this.writeData(db);

        const msg = `[Database] 🔄 Upserted ${newRecords.length} records for ${databaseId} (New: ${newCount}, Updated: ${updateCount}, Total: ${db.data_cache[databaseId].length})`;
        console.log(msg);
        debugLog(msg);
    }

    /**
     * Get last sync time for a database
     */
    getLastSyncTime(databaseId) {
        const db = this.readData();
        return db.metadata?.sync_times?.[databaseId] || null;
    }

    /**
     * Get all cached data for a database
     * @param {string} databaseId
     * @returns {Array}
     */
    getData(databaseId) {
        const db = this.readData();
        return db.data_cache?.[databaseId] || [];
    }

    /**
     * Get all cached data
     * @returns {Object} Object keyed by database ID
     */
    getAllData() {
        const db = this.readData();
        return db.data_cache || {};
    }

    /**
     * Save configuration
     * @param {string} key
     * @param {any} value
     */
    setConfig(key, value) {
        const db = this.readData();

        if (!db.config) {
            db.config = {};
        }

        db.config[key] = value;
        this.writeData(db);
    }

    /**
     * Get configuration
     * @param {string} key
     * @returns {any}
     */
    getConfig(key) {
        const db = this.readData();
        return db.config?.[key];
    }

    /**
     * Save metadata
     * @param {string} key
     * @param {string} value
     */
    setMetadata(key, value) {
        const db = this.readData();

        if (!db.metadata) {
            db.metadata = {};
        }

        db.metadata[key] = value;
        this.writeData(db);
    }

    /**
     * Get metadata
     * @param {string} key
     * @returns {string}
     */
    getMetadata(key) {
        const db = this.readData();
        return db.metadata?.[key];
    }

    /**
     * Get last update timestamp
     * @returns {string}
     */
    getLastUpdate() {
        return this.getMetadata('last_refresh');
    }

    /**
     * Close database connection (no-op for JSON files)
     */
    close() {
        console.log('[Database] Closed');
    }
}
