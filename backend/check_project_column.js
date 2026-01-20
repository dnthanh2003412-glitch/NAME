// Find which database has actual project names
import { DatabaseManager } from './src/database/db.js';
import fs from 'fs';

const db = new DatabaseManager();
const cacheData = JSON.parse(fs.readFileSync('./data/cache.json', 'utf8'));
const selectedDbs = db.getConfig('selected_databases') || [];

console.log('=== CHECKING SELECTED DATABASES FOR PROJECT COLUMN ===\n');

selectedDbs.forEach(dbId => {
    const records = cacheData.data_cache[dbId] || [];
    if (records.length === 0) {
        console.log(`${dbId}: EMPTY`);
        return;
    }

    const sample = records[0];
    const props = sample.properties || {};

    console.log(`\n${dbId}:`);
    console.log(`  Records: ${records.length}`);

    // Check for Project column
    if (props['Project']) {
        console.log(`  ✅ HAS 'Project' column`);
        console.log(`     Sample value: ${JSON.stringify(props['Project']).substring(0, 100)}`);
    } else {
        console.log(`  ❌ NO 'Project' column`);
    }

    // Check for Product column
    if (props['Product']) {
        console.log(`  📦 HAS 'Product' column`);
        console.log(`     Sample value: ${JSON.stringify(props['Product']).substring(0, 100)}`);
    }

    // List all properties
    console.log(`  All properties: ${Object.keys(props).slice(0, 10).join(', ')}`);
});

db.close();
