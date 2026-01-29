// Debug: Fetch Gene Tasks directly with verbose logging
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN });

const GENE_TASKS_ID = '28fccb0e-ac88-813d-a92a-f913c8e96f8d';

async function fetchGeneTasksData() {
    console.log('🔍 Fetching Gene Tasks data with verbose logging...\n');

    try {
        // First, get database info
        console.log('1. Getting database info...');
        const dbInfo = await notion.databases.retrieve({ database_id: GENE_TASKS_ID });
        console.log(`   ✅ Database name: ${dbInfo.title?.[0]?.plain_text}`);

        // Fetch all pages with pagination
        console.log('\n2. Fetching all pages...');
        let allPages = [];
        let hasMore = true;
        let startCursor = undefined;
        let pageCount = 0;
        let fetchErrors = [];

        while (hasMore) {
            try {
                console.log(`   Fetching page ${pageCount + 1}...`);
                const response = await notion.databases.query({
                    database_id: GENE_TASKS_ID,
                    start_cursor: startCursor,
                    page_size: 100
                });

                allPages = allPages.concat(response.results);
                hasMore = response.has_more;
                startCursor = response.next_cursor;
                pageCount++;

                console.log(`   ✅ Got ${response.results.length} items (Total: ${allPages.length})`);

                // Rate limiting
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 350));
                }
            } catch (pageError) {
                console.error(`   ❌ Error on page ${pageCount + 1}:`, pageError.message);
                fetchErrors.push({ page: pageCount + 1, error: pageError.message });
                break;
            }
        }

        console.log(`\n3. Summary:`);
        console.log(`   Total records: ${allPages.length}`);
        console.log(`   Total pages fetched: ${pageCount}`);
        console.log(`   Errors: ${fetchErrors.length}`);

        if (allPages.length > 0) {
            console.log('\n4. Sample record:');
            const sample = allPages[0];
            console.log(`   ID: ${sample.id}`);
            console.log(`   Created: ${sample.created_time}`);
            // Show title if exists
            for (const [key, prop] of Object.entries(sample.properties)) {
                if (prop.type === 'title') {
                    const title = prop.title.map(t => t.plain_text).join('');
                    console.log(`   Title: ${title}`);
                    break;
                }
            }
        }

    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        console.error('   Full error:', error);
    }
}

fetchGeneTasksData();
