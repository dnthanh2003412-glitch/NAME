// Check specific database in cache
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbId = '28fccb0e-ac88-813d-a92a-f913c8e96f8d';
const cachePath = join(__dirname, 'data', 'cache.json');
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));

console.log('=== CHECKING GENE TASKS IN CACHE ===\n');
console.log(`Database ID: ${dbId}`);

const records = cache.data_cache?.[dbId];
if (!records) {
    console.log('❌ Database NOT FOUND in cache!');
} else {
    console.log(`✅ Found! Records: ${records.length}`);
    console.log(`\nDatabase name: ${records[0]?.database_name}`);

    // Sort by created_time desc and show latest 10
    const sorted = [...records].sort((a, b) =>
        new Date(b.created_time) - new Date(a.created_time)
    ).slice(0, 10);

    console.log('\nLatest 10 records in cache:');
    sorted.forEach((r, i) => {
        const title = r._title || r.properties?.['Task Name'] || r.properties?.Name || 'No title';
        console.log(`${i + 1}. "${title}" (created: ${r.created_time})`);
    });

    // Search for "test 1"
    const testTask = records.find(r => {
        const title = r._title || r.properties?.['Task Name'] || r.properties?.Name || '';
        return title.toLowerCase().includes('test 1');
    });

    if (testTask) {
        console.log('\n✅ Task "test 1" FOUND in cache!');
        console.log(`   ID: ${testTask.id}`);
        console.log(`   Created: ${testTask.created_time}`);
    } else {
        console.log('\n❌ Task "test 1" NOT in cache!');
    }
}

console.log('\nLast refresh (metadata):', cache.metadata?.last_refresh);
console.log('Last sync time (per db):', cache.metadata?.sync_times?.[dbId] || 'None');
