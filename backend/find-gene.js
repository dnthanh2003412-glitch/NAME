// Find Gene Tasks database ID
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN;
const notion = new Client({ auth: token });

async function findGene() {
    const result = await notion.search({
        query: 'Gene',
        filter: { property: 'object', value: 'database' }
    });

    console.log('Databases containing "Gene":');
    for (const db of result.results) {
        const name = db.title?.[0]?.plain_text || 'Unknown';
        if (name.toLowerCase().includes('task')) {
            console.log(`\n*** [Gene] Tasks found! ***`);
            console.log(`  Name: ${name}`);
            console.log(`  ID: ${db.id}`);
        }
    }
}

findGene().catch(console.error);
