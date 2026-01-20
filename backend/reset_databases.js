// Script to reset database selection
import { DatabaseManager } from './src/database/db.js';

const db = new DatabaseManager();

console.log('Current selected databases:', db.getConfig('selected_databases')?.length || 0);

// Clear selection
db.setConfig('selected_databases', []);

console.log('✅ Database selection cleared!');
console.log('Please go to Setup page to select only the databases you need.');

db.close();
