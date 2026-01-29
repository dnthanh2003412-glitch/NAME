// Debug script to find Gene Tasks database
import fs from 'fs';

const cacheData = JSON.parse(fs.readFileSync('./data/cache.json', 'utf-8'));

console.log('=== Cache Structure ===');
console.log('Keys:', Object.keys(cacheData));

console.log('\n=== Config databases ===');
if (cacheData.config && cacheData.config.databases) {
    cacheData.config.databases.forEach((db, i) => {
        if (db.name && db.name.toLowerCase().includes('gene')) {
            console.log(`${i}: ${db.id} - ${db.name}`);
        }
    });
}

console.log('\n=== Metadata (database names) ===');
if (cacheData.metadata) {
    Object.entries(cacheData.metadata).forEach(([id, name]) => {
        if (name && name.toLowerCase().includes('gene')) {
            console.log(`${id} - ${name}`);
        }
    });
}

console.log('\n=== Data cache (records per database) ===');
if (cacheData.data_cache) {
    Object.entries(cacheData.data_cache).forEach(([id, records]) => {
        // Check first record for database_name
        if (records && records.length > 0 && records[0].database_name) {
            if (records[0].database_name.toLowerCase().includes('gene')) {
                console.log(`${id} - ${records[0].database_name}: ${records.length} records`);
            }
        } else if (cacheData.metadata && cacheData.metadata[id] && cacheData.metadata[id].toLowerCase().includes('gene')) {
            console.log(`${id} - ${cacheData.metadata[id]}: ${records?.length || 0} records`);
        }
    });
}

console.log('\n=== Looking for Gene Tasks specifically ===');
if (cacheData.metadata) {
    Object.entries(cacheData.metadata).forEach(([id, name]) => {
        if (name && name.toLowerCase().includes('gene') && name.toLowerCase().includes('task')) {
            console.log(`FOUND: ${id} - ${name}`);
            const records = cacheData.data_cache?.[id];
            console.log(`  Records in cache: ${records?.length || 0}`);
        }
    });
}
