
const fs = require('fs');
const path = require('path');

// Adjust path relative to where we run the script (backend root)
const dbPath = path.join(process.cwd(), 'data', 'cache.json');

console.log('Checking cache at:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.log('Cache file not found!');
    process.exit(1);
}

const content = fs.readFileSync(dbPath, 'utf8');
const data = JSON.parse(content);
const allData = data.data_cache || {};
console.log('Loaded databases:', Object.keys(allData).length);

const lookupMap = new Map();

// Helper to extract proper string from property
function extractString(val) {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object') {
        if (val.plain_text) return val.plain_text;
        // Maybe it's a Notion property object
        if (val.type === 'title' && val.title) return val.title.map(t => t.plain_text).join('');
        if (val.type === 'rich_text' && val.rich_text) return val.rich_text.map(t => t.plain_text).join('');
    }
    return null;
}

Object.values(allData).flat().forEach(record => {
    let name = record._title;

    if (!name && record.properties) {
        const props = record.properties;
        // Try exact matches
        let rawName = props['Name'] || props['Title'] || props['Tên'];

        // Try lowercase matches
        if (!rawName) {
            const lowerProps = Object.keys(props).reduce((acc, key) => { acc[key.toLowerCase()] = props[key]; return acc; }, {});
            rawName = lowerProps['name'] || lowerProps['title'] || lowerProps['task name'] || lowerProps['product name'] || lowerProps['project name'];
        }

        name = extractString(rawName) || rawName;
    }

    if (record.id) {
        const id = record.id.toLowerCase();
        if (name) {
            if (typeof name !== 'string') name = String(name);
            lookupMap.set(id, name);
        } else {
            lookupMap.set(id, '[Untitled Record]');
        }
    }
});

console.log('Lookup Map Size:', lookupMap.size);

// IDs from Screenshot
const targetIds = [
    '2a0ccb0e-ac88-80f5-9bb7-ef5e1a10bba2',
    '2b7ccb0e-ac88-80cf-a0f7-ad8549e864dc'
];

targetIds.forEach(tid => {
    const id = tid.toLowerCase();
    const val = lookupMap.get(id);
    console.log(`Check ${tid}: ${val ? val : '❌ NOT FOUND'}`);
});

// Search for any "Product" named records
let productCount = 0;
for (const [id, name] of lookupMap.entries()) {
    if (name.includes('Sunny Side') || name.includes('Product')) {
        if (productCount < 5) console.log(`Sample Product: ${id} -> ${name}`);
        productCount++;
    }
}
console.log(`Total "Sunny Side/Product" matches: ${productCount}`);
