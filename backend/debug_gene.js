
const fs = require('fs');
const path = require('path');

const dbPath = './data/cache.json';
if (!fs.existsSync(dbPath)) {
    console.log('Cache not found');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const cache = data.data_cache || {};

console.log(`Loaded ${Object.keys(cache).length} databases.`);

// Find "Gene" project databases
const geneDbs = [];
for (const [id, records] of Object.entries(cache)) {
    if (records.length === 0) continue;

    // Heuristic 1: Check database name from records if available (fetcher adds it)
    const first = records[0];
    const dbName = first.database_name || '';
    const projName = first.project_name || '';

    if (dbName.includes('Gene') || projName.includes('Gene')) {
        geneDbs.push({ id, name: dbName, count: records.length, project: projName });
    }
}

console.log('Found Gene Databases:', geneDbs);

// Specifically look for "Gene Product" (or similar)
const productDb = geneDbs.find(d => d.name.toLowerCase().includes('product'));
if (!productDb) {
    console.log('Could not find specific "Product" database for Gene.');
    // Try to guess by checking content? 
    // Just list all relations in all Gene DBs to see what's happening
} else {
    console.log(`\nInspecting Product DB: ${productDb.name} (${productDb.id})`);
    const records = cache[productDb.id];

    // Look for "Task" or "Tasks" relation column
    const sample = records[0];
    if (!sample) process.exit(0);

    const props = sample.properties;
    const taskKey = Object.keys(props).find(k => k.toLowerCase().includes('task') && Array.isArray(props[k])); // Relation is array

    if (!taskKey) {
        console.log('No "Task" column found in Product DB properties.');
        console.log('Available keys:', Object.keys(props));
    } else {
        console.log(`Checking column: "${taskKey}"`);

        let missingCount = 0;
        let foundCount = 0;
        const missingIds = new Set();

        // Build a mini lookup map of ALL records in cache
        const allIds = new Set();
        Object.values(cache).flat().forEach(r => {
            if (r.id) allIds.add(r.id.toLowerCase());
        });

        console.log(`Total cached IDs (lookup pool): ${allIds.size}`);

        records.slice(0, 5).forEach(r => {
            const relation = r.properties[taskKey];
            if (Array.isArray(relation) && relation.length > 0) {
                // Check first item
                const relItem = relation[0];
                // It might be just a string ID (fetcher transforms relations to ['id', 'id']) 
                // OR raw object { id: ... } depending on fetcher version?
                // Fetcher at line 186: return property.relation?.map(r => r.id) || [];
                // So it should be an array of string IDs.

                let idToCheck = (typeof relItem === 'object' && relItem.id) ? relItem.id : relItem;

                if (typeof idToCheck === 'string') {
                    if (allIds.has(idToCheck.toLowerCase())) {
                        foundCount++;
                        console.log(`Record ${r.id} -> Task ${idToCheck} : FOUND in cache.`);
                    } else {
                        missingCount++;
                        missingIds.add(idToCheck);
                        console.log(`Record ${r.id} -> Task ${idToCheck} : MISSING from cache.`);
                    }
                }
            }
        });

        if (missingIds.size > 0) {
            console.log(`\nSummary: IDs missing from cache: ${missingIds.size}`);
            console.log('User needs to select/fetch the database containing these Task IDs.');
        }
    }
}
