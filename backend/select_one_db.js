// Emergency: Select only 1 database for testing
import { DatabaseManager } from './src/database/db.js';
import fs from 'fs';

const db = new DatabaseManager();
const cacheData = JSON.parse(fs.readFileSync('./data/cache.json', 'utf8'));

// Find the database with most records (likely the main tasks database)
const dbsWithData = Object.keys(cacheData.data_cache || {})
    .filter(id => cacheData.data_cache[id]?.length > 0)
    .map(id => ({
        id,
        count: cacheData.data_cache[id].length,
        sample: cacheData.data_cache[id][0]
    }))
    .sort((a, b) => b.count - a.count);

console.log('=== TOP 5 DATABASES BY SIZE ===');
dbsWithData.slice(0, 5).forEach((db, i) => {
    const props = Object.keys(db.sample?.properties || {});
    console.log(`\n${i + 1}. ${db.id}`);
    console.log(`   Records: ${db.count}`);
    console.log(`   Properties: ${props.slice(0, 5).join(', ')}`);
});

// Select only the largest database (most likely to have task data)
const selectedDb = dbsWithData[0].id;
console.log(`\n✅ Selecting only: ${selectedDb} (${dbsWithData[0].count} records)`);

db.setConfig('selected_databases', [selectedDb]);

console.log('\nBây giờ:');
console.log('1. Restart server');
console.log('2. Refresh browser');
console.log('3. Sẽ load CỰC NHANH vì chỉ 1 database!');

db.close();
