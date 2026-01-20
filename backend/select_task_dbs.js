// Select multiple databases that likely contain task/sprint data
import { DatabaseManager } from './src/database/db.js';
import fs from 'fs';

const db = new DatabaseManager();
const cacheData = JSON.parse(fs.readFileSync('./data/cache.json', 'utf8'));

// Find databases with Sprint, Product, or Task-related properties
const relevantDbs = Object.keys(cacheData.data_cache || {})
    .filter(id => cacheData.data_cache[id]?.length > 0)
    .map(id => {
        const records = cacheData.data_cache[id];
        const sample = records[0];
        const props = Object.keys(sample?.properties || {});

        // Check if this database has task/sprint related properties
        const hasTaskProps = props.some(p =>
            p.includes('Task') || p.includes('task') ||
            p.includes('Sprint') || p.includes('sprint') ||
            p.includes('Product') || p.includes('Owner') ||
            p.includes('Assignee') || p.includes('Point')
        );

        return {
            id,
            count: records.length,
            props,
            hasTaskProps,
            score: hasTaskProps ? records.length : 0
        };
    })
    .filter(db => db.hasTaskProps)
    .sort((a, b) => b.score - a.score);

console.log('=== RELEVANT DATABASES (có Task/Sprint data) ===');
relevantDbs.slice(0, 10).forEach((dbInfo, i) => {
    console.log(`\n${i + 1}. ${dbInfo.id}`);
    console.log(`   Records: ${dbInfo.count}`);
    console.log(`   Properties: ${dbInfo.props.slice(0, 8).join(', ')}`);
});

// Select top 5 databases with task data
const selectedDbs = relevantDbs.slice(0, 5).map(d => d.id);
console.log(`\n✅ Selecting ${selectedDbs.length} databases with task/sprint data`);

db.setConfig('selected_databases', selectedDbs);

console.log('\nBây giờ:');
console.log('1. Restart server (Ctrl+C, npm start)');
console.log('2. Refresh browser (F5)');
console.log('3. Filters sẽ hoạt động và có đủ data!');

db.close();
