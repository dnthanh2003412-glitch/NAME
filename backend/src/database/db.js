import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync } from 'fs';
import debugLog from '../debug_logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * JSON File Database Manager - Split File Version
 * 
 * Cấu trúc thư mục:
 * backend/data/
 * ├── config.json      - Cấu hình (selected_databases, access_token, etc.)
 * ├── metadata.json    - Metadata (sync_times, last_refresh)
 * └── cache/
 *     ├── {database_id_1}.json
 *     ├── {database_id_2}.json
 *     └── ...
 * 
 * Ưu điểm:
 * - Load nhanh hơn (chỉ đọc DB cần thiết)
 * - Sync từng DB riêng lẻ
 * - Dễ backup/chuyển máy (copy folder data/)
 * - File nhỏ, dễ quản lý
 */
export class DatabaseManager {
    constructor(dataDir = null) {
        // Data directory
        const defaultDataDir = join(__dirname, '..', '..', 'data');
        this.dataDir = dataDir || process.env.DATA_DIR || defaultDataDir;
        
        // File paths
        this.configPath = join(this.dataDir, 'config.json');
        this.metadataPath = join(this.dataDir, 'metadata.json');
        this.cacheDir = join(this.dataDir, 'cache');
        
        // Legacy path for migration
        this.legacyPath = join(this.dataDir, 'cache.json');

        // Ensure directories exist
        if (!existsSync(this.dataDir)) {
            mkdirSync(this.dataDir, { recursive: true });
        }
        if (!existsSync(this.cacheDir)) {
            mkdirSync(this.cacheDir, { recursive: true });
        }

        // Initialize config if doesn't exist
        if (!existsSync(this.configPath)) {
            this._writeJson(this.configPath, {});
        }

        // Initialize metadata if doesn't exist
        if (!existsSync(this.metadataPath)) {
            this._writeJson(this.metadataPath, { sync_times: {} });
        }

        // Auto-migrate from legacy format if exists
        this._migrateFromLegacy();

        console.log(`[Database] ✅ Initialized (Split-file mode)`);
        console.log(`[Database]    Config: ${this.configPath}`);
        console.log(`[Database]    Cache:  ${this.cacheDir}`);
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Read JSON file safely
     */
    _readJson(filePath, defaultValue = {}) {
        try {
            if (!existsSync(filePath)) {
                return defaultValue;
            }
            const content = readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`[Database] Error reading ${filePath}:`, error.message);
            debugLog(`Error reading ${filePath}: ${error.message}`);
            return defaultValue;
        }
    }

    /**
     * Write JSON file safely
     */
    _writeJson(filePath, data) {
        try {
            writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error(`[Database] Error writing ${filePath}:`, error.message);
            debugLog(`Error writing ${filePath}: ${error.message}`);
        }
    }

    /**
     * Get cache file path for a database
     */
    _getCacheFilePath(databaseId) {
        // Sanitize database ID for filename
        const safeId = databaseId.replace(/[^a-zA-Z0-9-]/g, '_');
        return join(this.cacheDir, `${safeId}.json`);
    }

    /**
     * Migrate from legacy single-file format
     */
    _migrateFromLegacy() {
        if (!existsSync(this.legacyPath)) {
            return;
        }

        // Check if already migrated (cache folder has files)
        try {
            const existingFiles = readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
            if (existingFiles.length > 0) {
                debugLog('Migration skipped: cache folder already has data');
                return;
            }
        } catch (e) {
            // Continue with migration
        }

        try {
            console.log('[Database] 🔄 Migrating from legacy format...');
            
            const legacyData = this._readJson(this.legacyPath, null);
            if (!legacyData) {
                console.log('[Database] Legacy file empty or invalid, skipping migration');
                return;
            }

            let migratedCount = 0;

            // Migrate config
            if (legacyData.config && Object.keys(legacyData.config).length > 0) {
                const existingConfig = this._readJson(this.configPath, {});
                const mergedConfig = { ...existingConfig, ...legacyData.config };
                this._writeJson(this.configPath, mergedConfig);
                console.log('[Database]    ✅ Config migrated');
            }

            // Migrate metadata
            if (legacyData.metadata) {
                const existingMeta = this._readJson(this.metadataPath, {});
                const mergedMeta = { ...existingMeta, ...legacyData.metadata };
                this._writeJson(this.metadataPath, mergedMeta);
                console.log('[Database]    ✅ Metadata migrated');
            }

            // Migrate data_cache (split into individual files)
            if (legacyData.data_cache) {
                for (const [dbId, records] of Object.entries(legacyData.data_cache)) {
                    if (Array.isArray(records) && records.length > 0) {
                        const cacheFile = this._getCacheFilePath(dbId);
                        this._writeJson(cacheFile, records);
                        migratedCount++;
                    }
                }
                console.log(`[Database]    ✅ ${migratedCount} databases migrated to split files`);
            }

            // Rename legacy file to backup (don't delete)
            const backupPath = join(this.dataDir, 'cache_legacy_backup.json');
            if (!existsSync(backupPath)) {
                renameSync(this.legacyPath, backupPath);
                console.log('[Database]    ✅ Legacy file renamed to cache_legacy_backup.json');
            }

            console.log('[Database] ✅ Migration completed!');
        } catch (error) {
            console.error('[Database] ❌ Migration error:', error.message);
            debugLog(`Migration error: ${error.message}`);
        }
    }

    // ==================== CONFIG METHODS ====================

    /**
     * Save configuration
     * @param {string} key
     * @param {any} value
     */
    setConfig(key, value) {
        const config = this._readJson(this.configPath, {});
        config[key] = value;
        this._writeJson(this.configPath, config);
        debugLog(`Config set: ${key}`);
    }

    /**
     * Get configuration
     * @param {string} key
     * @returns {any}
     */
    getConfig(key) {
        const config = this._readJson(this.configPath, {});
        return config[key];
    }

    /**
     * Get all config
     */
    getAllConfig() {
        return this._readJson(this.configPath, {});
    }

    // ==================== METADATA METHODS ====================

    /**
     * Save metadata
     * @param {string} key
     * @param {any} value
     */
    setMetadata(key, value) {
        const metadata = this._readJson(this.metadataPath, {});
        metadata[key] = value;
        this._writeJson(this.metadataPath, metadata);
    }

    /**
     * Get metadata
     * @param {string} key
     * @returns {any}
     */
    getMetadata(key) {
        const metadata = this._readJson(this.metadataPath, {});
        return metadata[key];
    }

    /**
     * Get last sync time for a database
     */
    getLastSyncTime(databaseId) {
        const metadata = this._readJson(this.metadataPath, {});
        return metadata.sync_times?.[databaseId] || null;
    }

    /**
     * Update sync time for a database
     */
    _updateSyncTime(databaseId) {
        const metadata = this._readJson(this.metadataPath, {});
        if (!metadata.sync_times) metadata.sync_times = {};
        metadata.sync_times[databaseId] = new Date().toISOString();
        metadata.last_refresh = new Date().toISOString();
        this._writeJson(this.metadataPath, metadata);
    }

    /**
     * Get last update timestamp
     * @returns {string}
     */
    getLastUpdate() {
        return this.getMetadata('last_refresh');
    }

    // ==================== DATA METHODS ====================

    /**
     * Save data from a database (overwrite)
     * @param {string} databaseId
     * @param {Array} records
     */
    saveData(databaseId, records) {
        const cacheFile = this._getCacheFilePath(databaseId);
        this._writeJson(cacheFile, records);
        this._updateSyncTime(databaseId);

        console.log(`[Database] ✅ Saved ${records.length} records for ${databaseId.substring(0, 8)}...`);
        debugLog(`Saved ${records.length} records for ${databaseId}`);
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

        const cacheFile = this._getCacheFilePath(databaseId);
        const existingData = this._readJson(cacheFile, []);
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

        // Convert back to array and save
        const mergedData = Array.from(existingMap.values());
        this._writeJson(cacheFile, mergedData);
        this._updateSyncTime(databaseId);

        const msg = `[Database] 🔄 Upserted for ${databaseId.substring(0, 8)}... (New: ${newCount}, Updated: ${updateCount}, Total: ${mergedData.length})`;
        console.log(msg);
        debugLog(msg);
    }

    /**
     * Get all cached data for a database
     * @param {string} databaseId
     * @returns {Array}
     */
    getData(databaseId) {
        const cacheFile = this._getCacheFilePath(databaseId);
        return this._readJson(cacheFile, []);
    }

    /**
     * Get all cached data (loads all database files)
     * @returns {Object} Object keyed by database ID
     */
    getAllData() {
        const allData = {};
        
        try {
            const files = readdirSync(this.cacheDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const dbId = file.replace('.json', '');
                    const filePath = join(this.cacheDir, file);
                    const data = this._readJson(filePath, []);
                    if (data.length > 0) {
                        allData[dbId] = data;
                    }
                }
            }
        } catch (error) {
            console.error('[Database] Error reading cache directory:', error.message);
        }

        return allData;
    }

    /**
     * Get data for selected databases only (optimized)
     * @returns {Object} Object keyed by database ID
     */
    getSelectedData() {
        const selectedDbs = this.getConfig('selected_databases') || [];
        const data = {};
        
        for (const dbId of selectedDbs) {
            data[dbId] = this.getData(dbId);
        }
        
        return data;
    }

    /**
     * Delete cache for a database
     * @param {string} databaseId
     */
    deleteData(databaseId) {
        const cacheFile = this._getCacheFilePath(databaseId);
        if (existsSync(cacheFile)) {
            unlinkSync(cacheFile);
            console.log(`[Database] 🗑️ Deleted cache for ${databaseId.substring(0, 8)}...`);
        }
    }

    /**
     * Clear all cache files
     */
    clearAllCache() {
        try {
            const files = readdirSync(this.cacheDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    unlinkSync(join(this.cacheDir, file));
                }
            }
            console.log('[Database] 🗑️ All cache cleared');
        } catch (error) {
            console.error('[Database] Error clearing cache:', error.message);
        }
    }

    // ==================== COMPATIBILITY METHODS ====================
    
    /**
     * Legacy compatibility: Read entire "database"
     * Returns combined structure for backward compatibility
     */
    readData() {
        return {
            config: this._readJson(this.configPath, {}),
            metadata: this._readJson(this.metadataPath, {}),
            data_cache: this.getAllData()
        };
    }

    /**
     * Legacy compatibility: Write entire "database"
     * Splits data back to individual files
     */
    writeData(data) {
        if (data.config) {
            this._writeJson(this.configPath, data.config);
        }
        if (data.metadata) {
            this._writeJson(this.metadataPath, data.metadata);
        }
        if (data.data_cache) {
            for (const [dbId, records] of Object.entries(data.data_cache)) {
                if (Array.isArray(records)) {
                    const cacheFile = this._getCacheFilePath(dbId);
                    this._writeJson(cacheFile, records);
                }
            }
        }
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Get cache statistics
     */
    getStats() {
        const stats = {
            databases: 0,
            totalRecords: 0,
            cacheFiles: [],
            lastRefresh: this.getLastUpdate()
        };

        try {
            const files = readdirSync(this.cacheDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = join(this.cacheDir, file);
                    const data = this._readJson(filePath, []);
                    const fileStats = {
                        id: file.replace('.json', ''),
                        records: data.length,
                        file: file
                    };
                    stats.cacheFiles.push(fileStats);
                    stats.databases++;
                    stats.totalRecords += data.length;
                }
            }
        } catch (error) {
            console.error('[Database] Error getting stats:', error.message);
        }

        return stats;
    }

    /**
     * Export all data for backup/transfer
     * @returns {Object} Complete data export
     */
    exportAll() {
        return {
            exportTime: new Date().toISOString(),
            config: this._readJson(this.configPath, {}),
            metadata: this._readJson(this.metadataPath, {}),
            data_cache: this.getAllData()
        };
    }

    /**
     * Import data from backup
     * @param {Object} data - Data to import
     */
    importAll(data) {
        if (data.config) {
            this._writeJson(this.configPath, data.config);
        }
        if (data.metadata) {
            this._writeJson(this.metadataPath, data.metadata);
        }
        if (data.data_cache) {
            for (const [dbId, records] of Object.entries(data.data_cache)) {
                if (Array.isArray(records)) {
                    this.saveData(dbId, records);
                }
            }
        }
        console.log('[Database] ✅ Import completed');
    }

    /**
     * Close database connection (no-op for JSON files)
     */
    close() {
        console.log('[Database] Closed');
    }
}

// Singleton instance for shared usage
let _singleton = null;

export function getDbInstance() {
    if (!_singleton) {
        _singleton = new DatabaseManager();
    }
    return _singleton;
}
