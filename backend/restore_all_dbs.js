// Quick restore - put back all databases that have cached data
import { DatabaseManager } from './src/database/db.js';
import fs from 'fs';

const db = new DatabaseManager();
const cacheData = JSON.parse(fs.readFileSync('./data/cache.json', 'utf8'));

// Get all database IDs that have cached data
const dbsWithData = Object.keys(cacheData.data_cache || {}).filter(id => {
    const records = cacheData.data_cache[id];
    return records && records.length > 0;
});

console.log(`Restoring ${dbsWithData.length} databases...`);

// Restore the selection
db.setConfig('selected_databases', dbsWithData);

console.log('✅ Restored! Databases selected:', dbsWithData.length);
console.log('\nBây giờ:');
console.log('1. Restart server (Ctrl+C rồi npm start)');
console.log('2. Refresh trang Dashboard (F5)');
console.log('3. Data sẽ hiện ngay vì đã có trong cache!');

db.close();
