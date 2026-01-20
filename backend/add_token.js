// Extract access token from cache.json and add to .env
const fs = require('fs');
const path = require('path');

const cacheFile = path.join(__dirname, 'data', 'cache.json');
const envFile = path.join(__dirname, '.env');

// Read cache
const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
const token = cache.config?.access_token;

if (!token) {
    console.error('❌ No access_token found in cache.json');
    process.exit(1);
}

console.log('✅ Found access token in cache.json');

// Read current .env
let envContent = fs.readFileSync(envFile, 'utf8');

// Add or update NOTION_ACCESS_TOKEN
if (envContent.includes('NOTION_ACCESS_TOKEN=')) {
    envContent = envContent.replace(/NOTION_ACCESS_TOKEN=.*/g, `NOTION_ACCESS_TOKEN=${token}`);
    console.log('✅ Updated NOTION_ACCESS_TOKEN in .env');
} else {
    envContent += `\n# Direct Notion Access Token (bypass OAuth)\nNOTION_ACCESS_TOKEN=${token}\n`;
    console.log('✅ Added NOTION_ACCESS_TOKEN to .env');
}

fs.writeFileSync(envFile, envContent);

console.log('\n🎉 Done! Restart server với: npm start');
