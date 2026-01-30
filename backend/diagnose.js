// Diagnose script: Verify "test 1" exisence in Notion API vs Cache
// FIXED: Removed property filter that caused validation error
import { Client } from '@notionhq/client';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const token = process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN;
const dbId = '28fccb0e-ac88-813d-a92a-f913c8e96f8d'; // Gene Tasks

console.log('=== DIAGNOSTIC REPORT (FIXED) ===');

async function run() {
    // 1. Check Notion API directly
    console.log('\n1. Checking Notion API directly...');
    const notion = new Client({ auth: token });

    try {
        // Just fetch recent created items, no property filter to avoid errors
        const recent = await notion.databases.query({
            database_id: dbId,
            sorts: [{ timestamp: 'created_time', direction: 'descending' }],
            page_size: 50 // Increased to 50 to look deeper
        });

        console.log(`   Fetched ${recent.results.length} recent items.`);

        const targetTask = recent.results.find(p => {
            // Try to find title in any property (robust search)
            const props = Object.values(p.properties);
            const titleProp = props.find(prop => prop.type === 'title');

            if (!titleProp) return false;

            const titleText = titleProp.title?.map(t => t.plain_text).join('') || '';
            return titleText.toLowerCase().includes('test 1');
        });

        if (targetTask) {
            console.log(`✅ FOUND "test 1" in Notion API!`);
            console.log(`   ID: ${targetTask.id}`);
            console.log(`   Created: ${targetTask.created_time}`);
            console.log(`   Title: ${targetTask.properties['Name']?.title?.[0]?.plain_text || 'checked via id'}`);
        } else {
            console.log(`❌ "test 1" NOT FOUND in top 50 recent items via API.`);
            console.log('   Recent 5 items found:');
            recent.results.slice(0, 5).forEach(p => {
                const props = Object.values(p.properties);
                const titleProp = props.find(prop => prop.type === 'title');
                const title = titleProp?.title?.map(t => t.plain_text).join('') || 'No title';
                console.log(`   - ${title} (${p.created_time})`);
            });
        }

        // 2. Check Cache File
        console.log('\n2. Checking Cache File...');
        const cachePath = join(__dirname, 'data', 'cache.json');
        if (!process.env.DB_PATH) console.log(`   Reading from default: ${cachePath}`);

        const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
        const records = cache.data_cache?.[dbId] || [];
        console.log(`   Cache has ${records.length} records for Gene Tasks.`);

        const cachedTask = records.find(r =>
            (r._title && r._title.toLowerCase().includes('test 1')) ||
            (targetTask && r.id === targetTask.id)
        );

        if (cachedTask) {
            console.log(`✅ FOUND "test 1" in Cache!`);
        } else {
            console.log(`❌ "test 1" NOT FOUND in Cache.`);
            // Check top recent in cache
            const sortedCache = [...records].sort((a, b) => new Date(b.created_time) - new Date(a.created_time)).slice(0, 5);
            console.log('   Recent 5 in Cache:');
            sortedCache.forEach(r => console.log(`   - ${r._title} (${r.created_time})`));
        }

    } catch (err) {
        console.error('Error:', err);
    }
}

run();
