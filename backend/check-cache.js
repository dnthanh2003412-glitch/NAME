// Check database IDs and cache status
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cachePath = join(__dirname, 'data', 'cache.json');
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));

console.log('=== CACHE STATUS ===\n');

// Check config
console.log('Selected databases (from config):');
const selected = cache.config?.selected_databases || [];
console.log(`Count: ${selected.length}`);
selected.forEach(id => console.log(`  - ${id}`));

console.log('\n\nCached data databases:');
const cachedDbs = Object.keys(cache.data_cache || {});
console.log(`Count: ${cachedDbs.length}`);

// Find Gene Tasks database in cache
console.log('\n\nSearching for Gene Tasks in cache...');
for (const [dbId, records] of Object.entries(cache.data_cache || {})) {
    if (!Array.isArray(records) || records.length === 0) continue;

    const dbName = records[0]?.database_name || 'Unknown';
    if (dbName.toLowerCase().includes('gene') && dbName.toLowerCase().includes('task')) {
        console.log(`\nFound: ${dbName} (${dbId})`);
        console.log(`  Records in cache: ${records.length}`);

        // Search for "test" task
        const testTask = records.find(r =>
            r._title?.toLowerCase() === 'test' ||
            Object.values(r.properties || {}).some(v => String(v).toLowerCase() === 'test')
        );

        if (testTask) {
            console.log(`  ✅ Task "test" FOUND in cache!`);
            console.log(`    Created: ${testTask.created_time}`);
        } else {
            console.log(`  ❌ Task "test" NOT found in cache`);
            // Show latest 5 records
            console.log(`  Latest 5 records in cache:`);
            const sorted = [...records].sort((a, b) =>
                new Date(b.created_time) - new Date(a.created_time)
            ).slice(0, 5);
            sorted.forEach(r => {
                console.log(`    - ${r._title || 'No title'} (${r.created_time})`);
            });
        }
    }
}

console.log('\n\nLast refresh:', cache.metadata?.last_refresh || 'Never');
