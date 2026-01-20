const fs = require('fs');
const path = require('path');

// Read cache.json
const cachePath = path.join(__dirname, 'data', 'cache.json');
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const token = cache.config?.access_token;

if (!token) {
    console.error('❌ No access_token found in cache.json');
    process.exit(1);
}

console.log('✅ Found token:', token.substring(0, 20) + '...');

// Read .env
const envPath = path.join(__dirname, '.env');
let envContent = '';

try {
    envContent = fs.readFileSync(envPath, 'utf8');
} catch (e) {
    console.log('Creating new .env file...');
}

// Remove old token lines
envContent = envContent.split('\n').filter(line =>
    !line.startsWith('NOTION_ACCESS_TOKEN=') &&
    !line.startsWith('NOTION_TOKEN=')
).join('\n');

// Add new token
envContent += `\n\n# Notion Access Token\nNOTION_ACCESS_TOKEN=${token}\n`;

fs.writeFileSync(envPath, envContent.trim() + '\n');

console.log('✅ Token added to .env');
console.log('\nRestart server: npm start');
