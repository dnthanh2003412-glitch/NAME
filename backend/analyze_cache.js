// Restore previous database selection
import { DatabaseManager } from './src/database/db.js';
import fs from 'fs';

const db = new DatabaseManager();

// Read the backup from cache.json to see what was selected before
const cacheData = JSON.parse(fs.readFileSync('./data/cache.json', 'utf8'));

console.log('=== RESTORING DATABASE SELECTION ===');

// Get all database IDs that have cached data
const dbsWithData = Object.keys(cacheData.data_cache || {}).filter(id => {
    const records = cacheData.data_cache[id];
    return records && records.length > 0;
});

console.log(`Found ${dbsWithData.length} databases with cached data`);

// Show sample of what's in each database
console.log('\n=== DATABASES WITH DATA ===');
dbsWithData.slice(0, 10).forEach(id => {
    const records = cacheData.data_cache[id];
    const sample = records[0];
    const props = Object.keys(sample?.properties || {});
    console.log(`\n${id}:`);
    console.log(`  Records: ${records.length}`);
    console.log(`  Sample properties: ${props.slice(0, 5).join(', ')}`);
});

console.log('\n=== RECOMMENDATION ===');
console.log('Bạn muốn:');
console.log('1. Restore TẤT CẢ databases cũ? (chậm nhưng có đầy đủ data)');
console.log('2. Chỉ chọn 1 vài databases quan trọng? (nhanh hơn)');
console.log('\nĐể restore tất cả, chạy: node restore_all_dbs.js');

db.close();
