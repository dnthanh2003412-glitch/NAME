// Script to clear cached data and force refresh
import { DatabaseManager } from './src/database/db.js';

const db = new DatabaseManager();

console.log('=== CLEARING CACHE ===');
console.log('Current data:', Object.keys(db.getAllData()).length, 'databases');

// Clear all cached data
const dbData = db.readData();
dbData.data_cache = {};
db.writeData(dbData);

console.log('✅ Cache cleared!');
console.log('Please restart the server to fetch fresh data with project_name field.');

db.close();
