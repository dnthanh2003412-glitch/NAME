// Add the database with actual project names
import { DatabaseManager } from './src/database/db.js';

const db = new DatabaseManager();
const current = db.getConfig('selected_databases') || [];

// Add the database that has Project column with real names
const projectDbId = '2d3ccb0e-ac88-812a-af94-c2a37b2329ad';

if (!current.includes(projectDbId)) {
    current.push(projectDbId);
    db.setConfig('selected_databases', current);
    console.log(`✅ Added database with Project names: ${projectDbId}`);
    console.log(`Total selected: ${current.length} databases`);
} else {
    console.log(`Database ${projectDbId} already selected`);
}

console.log('\nRestart server và refresh browser để thấy tên dự án thật!');

db.close();
