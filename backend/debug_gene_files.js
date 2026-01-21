
const fs = require('fs');

const logFile = './gene_log.txt';
function log(msg) {
    try {
        const current = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
        fs.writeFileSync(logFile, current + msg + '\n', 'utf8');
    } catch (e) { }
}

const dbPath = './data/cache.json';
if (!fs.existsSync(dbPath)) {
    log('Cache not found');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const cache = data.data_cache || {};

log(`Loaded ${Object.keys(cache).length} databases.`);

const geneDbs = [];
for (const [id, records] of Object.entries(cache)) {
    if (records.length === 0) continue;
    const first = records[0];
    const dbName = first.database_name || '';
    if (dbName.includes('Gene')) {
        geneDbs.push({ id, name: dbName });
    }
}
log(`Found ${geneDbs.length} Gene databases.`);

const productDb = geneDbs.find(d => d.name.toLowerCase().includes('product'));

if (!productDb) {
    log('No Gene Product found.');
} else {
    log(`Checking Gene Product: ${productDb.name}`);
    const records = cache[productDb.id];

    // Check Task relation
    // Find key
    const first = records[0];
    const taskKey = Object.keys(first.properties).find(k => k.toLowerCase().includes('task'));

    if (!taskKey) log('No Task column found');
    else {
        log(`Col: ${taskKey}`);

        // Build ID set
        const allIds = new Set();
        Object.values(cache).flat().forEach(r => {
            if (r.id) allIds.add(r.id.toLowerCase());
        });

        records.slice(0, 5).forEach(r => {
            const val = r.properties[taskKey];
            if (Array.isArray(val) && val.length > 0) {
                const id = val[0];
                const found = allIds.has(String(id).toLowerCase());
                log(`Rec ${r.id.substr(0, 4)} -> Task ${String(id).substr(0, 4)}... : ${found ? 'FOUND' : 'MISSING'}`);
            } else {
                log(`Rec ${r.id.substr(0, 4)} -> Empty/Null`);
            }
        });
    }
}
