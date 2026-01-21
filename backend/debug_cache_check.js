
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to data/cache.json relative to backend/src/database/db.js location?
// No, we are running this script from backend/ root usually.
// Let's try absolute path resolution or relative to CWD.

const possiblePaths = [
    './data/cache.json',
    '../data/cache.json',
    './backend/data/cache.json',
    'c:/Users/Datpq/Desktop/Dash Notion/backend/data/cache.json'
];

let data = null;
let loadedPath = '';

for (const p of possiblePaths) {
    if (existsSync(p)) {
        try {
            const content = readFileSync(p, 'utf8');
            data = JSON.parse(content);
            loadedPath = p;
            break;
        } catch (e) {
            console.error(`Error reading ${p}:`, e.message);
        }
    }
}

if (!data) {
    console.error("❌ Could not locate or read cache.json");
    process.exit(1);
}

console.log(`✅ Loaded cache from: ${loadedPath}`);
const cache = data.data_cache || {};
const databases = Object.keys(cache);

console.log(`Found ${databases.length} databases in cache.`);

// Target ID to find (from user screenshot/logs)
// 2a0ccb0e-ac88-80f5-9bb7-ef5e1a10bba2
const targetID = '2a0ccb0e-ac88-80f5-9bb7-ef5e1a10bba2';

console.log(`\n🔍 Searching for ID: ${targetID}...`);

let found = false;
let foundInDb = '';
let foundName = '';

// scan all records
for (const [dbId, records] of Object.entries(cache)) {
    console.log(`- Checking DB ${dbId} (${records.length} records)...`);

    // Check if this DB *is* the one we want (by checking if records look like products)
    // Just heuristic
    const first = records[0];
    if (first && first.database_name) {
        // console.log(`  Name: ${first.database_name}`);
    }

    for (const record of records) {
        if (record.id === targetID) {
            found = true;
            foundInDb = dbId;
            foundName = record._title || 'No Title';
            if (!foundName && record.properties) {
                foundName = JSON.stringify(record.properties).substring(0, 50);
            }
            console.log(`\n🎉 FOUND IT!`);
            console.log(`  Database ID: ${dbId}`);
            console.log(`  Record ID: ${record.id}`);
            console.log(`  Name/Title: ${foundName}`);
            console.log(`  Raw Record Keys: ${Object.keys(record).join(', ')}`);
            break;
        }
    }
    if (found) break;
}

if (!found) {
    console.log(`\n❌ ID ${targetID} was NOT found in any cached database.`);
    console.log("Possible reasons:");
    console.log("1. The database containing this record was not selected/fetched.");
    console.log("2. The record was deleted.");
    console.log("3. The ID in the relation column points to a different database/record than expected.");
} else {
    console.log("\n✅ Record exists in cache. The bug is in routes.js lookup logic.");
}
