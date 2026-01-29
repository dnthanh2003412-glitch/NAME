import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();
const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN });

async function checkDb(id) {
    try {
        console.log(`Checking ${id}...`);
        const db = await notion.databases.retrieve({ database_id: id });
        console.log(`Title: ${db.title[0]?.plain_text}`);
        console.log('Properties:', Object.keys(db.properties));
    } catch (e) {
        console.log(`Error retrieving ${id}:`, e.message);

        // Try querying
        try {
            console.log('Trying to query...');
            const q = await notion.databases.query({ database_id: id, page_size: 1 });
            if (q.results.length > 0) {
                console.log('Query success! First record props:', Object.keys(q.results[0].properties));
            } else {
                console.log('Query success but empty.');
            }
        } catch (e2) {
            console.log('Query failed:', e2.message);
        }
    }
}

(async () => {
    await checkDb('28fccb0e-ac88-817b-8eb3-fb5a800ff922');
    await checkDb('28fccb0e-ac88-811f-a729-e28a2dfa12ca');
})();
