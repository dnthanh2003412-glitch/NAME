// Quick test script to search for task "test" directly from Notion
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN;
const notion = new Client({ auth: token });

// Gene Tasks database ID from cache - need to find it
async function searchForTest() {
    console.log('Token:', token ? 'Set' : 'Not set');

    // First, let's search for the database
    const searchResult = await notion.search({
        query: 'Gene Tasks',
        filter: { property: 'object', value: 'database' }
    });

    console.log(`Found ${searchResult.results.length} databases matching "Gene Tasks"`);

    for (const db of searchResult.results) {
        const dbName = db.title?.[0]?.plain_text || 'Unknown';
        console.log(`\nDatabase: ${dbName} (${db.id})`);

        if (dbName.includes('Gene') && dbName.includes('Task')) {
            console.log('Searching for "test" in this database...');

            // Query latest 20 items sorted by created time desc
            const queryResult = await notion.databases.query({
                database_id: db.id,
                sorts: [{ timestamp: 'created_time', direction: 'descending' }],
                page_size: 20
            });

            console.log(`Latest ${queryResult.results.length} items:`);
            for (const page of queryResult.results) {
                const titleProp = Object.values(page.properties).find(p => p.type === 'title');
                const title = titleProp?.title?.[0]?.plain_text || 'No title';
                console.log(`- ${title} (created: ${page.created_time})`);
            }
        }
    }
}

searchForTest().catch(console.error);
