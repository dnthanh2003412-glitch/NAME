// Quick debug script to check data status
import { DatabaseManager } from './src/database/db.js';

const db = new DatabaseManager();

console.log('=== DATABASE STATUS ===');
console.log('Selected databases:', db.getConfig('selected_databases')?.length || 0);
console.log('Database IDs:', db.getConfig('selected_databases'));

const allData = db.getAllData();
const dbIds = Object.keys(allData);

console.log('\n=== CACHED DATA ===');
console.log('Total databases with data:', dbIds.length);

dbIds.forEach(id => {
    const records = allData[id];
    console.log(`\n${id}:`);
    console.log(`  - Records: ${records.length}`);

    if (records.length > 0) {
        const sample = records[0];
        const props = Object.keys(sample.properties || {});
        console.log(`  - Properties: ${props.join(', ')}`);
    }
});

console.log('\n=== LAST UPDATE ===');
console.log('Last refresh:', db.getLastUpdate() || 'Never');

db.close();
