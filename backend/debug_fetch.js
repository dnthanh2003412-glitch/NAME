import { config } from 'dotenv';
import { DataFetcher } from './src/notion/fetcher.js';
import { db } from './src/database/db.js';

config();

async function debugNotionData() {
    console.log('--- Debugging Notion Data ---');

    // 1. Check Env
    if (!process.env.NOTION_TOKEN) {
        console.error('❌ Missing NOTION_TOKEN in .env');
        return;
    }

    // 2. Get Databases from Cache or Discovery
    const savedDbs = db.getConfig('selected_databases') || [];
    console.log(`Saved Database IDs: ${savedDbs.length}`);
    savedDbs.forEach(id => console.log(` - ${id}`));

    if (savedDbs.length === 0) {
        console.warn('⚠️ No databases selected! Go to "Setup" page to select databases.');
        return;
    }

    const fetcher = new DataFetcher(process.env.NOTION_TOKEN);
    const dbIds = savedDbs;

    // 3. Fetch 5 pages from each DB
    for (const dbId of dbIds) {
        console.log(`\nFetching sample from DB: ${dbId}...`);
        try {
            // We use client directly to limit results if possible, but fetcher gets all.
            // Let's just use fetcher.client to get 1 page.
            const response = await fetcher.client.notion.databases.query({
                database_id: dbId,
                page_size: 1
            });

            if (response.results.length === 0) {
                console.log('  ⚠️ Database is empty (0 records)');
            } else {
                const page = response.results[0];
                console.log('  ✅ Fetched 1 record. Properties found:');
                const propKeys = Object.keys(page.properties);
                propKeys.forEach(k => {
                    const type = page.properties[k].type;
                    console.log(`    - "${k}" (${type})`);
                });

                // Dump the 'Product' or 'Sprint' property values to see what they look like
                console.log('  Sample Property Values:');
                ['Sprint', 'Product', 'Sản phẩm', 'Dự án', 'Project', 'Assignee', 'Status'].forEach(key => {
                    if (page.properties[key]) {
                        console.log(`    ${key}:`, JSON.stringify(page.properties[key], null, 2));
                    }
                });
            }

        } catch (e) {
            console.error(`  ❌ Failed to fetch: ${e.message}`);
        }
    }
}

debugNotionData();
