// Reset Cache but keep Config
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cachePath = join(__dirname, 'data', 'cache.json');

console.log('=== CACHE RESET TOOL ===');
console.log(`Target: ${cachePath}`);

try {
    if (existsSync(cachePath)) {
        const raw = readFileSync(cachePath, 'utf8');
        const db = JSON.parse(raw);

        const recordCount = Object.values(db.data_cache || {}).reduce((acc, arr) => acc + arr.length, 0);
        console.log(`Current Cache: ${recordCount} records.`);

        // Reset Cache and Metadata
        db.data_cache = {};
        db.metadata = {};

        // Keep Config
        console.log('Configuration preserved.');

        writeFileSync(cachePath, JSON.stringify(db, null, 2), 'utf8');
        console.log('✅ Cache cleared successfully. System is ready for Full Re-sync.');
    } else {
        console.log('Cache file not found. Nothing to reset.');
    }
} catch (err) {
    console.error('❌ Error resetting cache:', err);
}
