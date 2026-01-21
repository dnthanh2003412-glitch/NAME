
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const logFile = './debug_results.txt';
function log(msg) {
    // console.log(msg); // Optional
    try {
        const current = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
        writeFileSync(logFile, current + msg + '\n', 'utf8');
    } catch (e) { }
}

// Clear log
writeFileSync(logFile, '', 'utf8');

log("Starting debug check...");

const possiblePaths = [
    './data/cache.json',
    '../data/cache.json',
    'c:/Users/Datpq/Desktop/Dash Notion/backend/data/cache.json'
];

let data = null;
let loadedPath = '';

for (const p of possiblePaths) {
    if (existsSync(p)) {
        log(`Found file at: ${p}`);
        try {
            const content = readFileSync(p, 'utf8');
            data = JSON.parse(content);
            loadedPath = p;
            break;
        } catch (e) {
            log(`Error reading ${p}: ${e.message}`);
        }
    }
}

if (!data) {
    log("❌ Could not locate or read cache.json");
    process.exit(1);
}

log(`✅ Loaded cache from: ${loadedPath}`);
const cache = data.data_cache || {};
const databases = Object.keys(cache);
log(`Databases count: ${databases.length}`);

const targetID = '2a0ccb0e-ac88-80f5-9bb7-ef5e1a10bba2'.toLowerCase();
let found = false;

for (const [dbId, records] of Object.entries(cache)) {
    log(`Checking DB ${dbId} - ${records.length} records`);

    // Check first 3 IDs to see format
    // log(`Sample IDs: ${records.slice(0, 3).map(r => r.id).join(', ')}`);

    for (const record of records) {
        if (record.id.toLowerCase() === targetID) {
            found = true;
            log(`\n🎉 FOUND IT!`);
            log(`  Database ID: ${dbId}`);
            log(`  Record ID: ${record.id}`);

            let name = record._title;
            if (!name && record.properties) {
                const props = record.properties;
                name = props['Name'] || props['Title'] || props['Tên'] || props['Task Name'] || props['Product Name'];
                if (typeof name === 'object') name = JSON.stringify(name);
            }
            log(`  Derived Name: ${name}`);
            break;
        }
    }
    if (found) break;
}

if (!found) {
    log(`❌ Target ID ${targetID} NOT found in ANY database.`);
}
