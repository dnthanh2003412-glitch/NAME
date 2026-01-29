import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN });

async function searchAllDatabases() {
    console.log('🔍 Searching ALL databases visible to bot...\n');

    try {
        const response = await notion.search({
            filter: {
                value: 'database',
                property: 'object'
            },
            page_size: 100
        });

        console.log(`✅ Found ${response.results.length} databases.`);

        const geneDbs = response.results.filter(db =>
            db.title[0]?.plain_text.toLowerCase().includes('gene')
        );

        console.log(`\n🔍 Found ${geneDbs.length} "Gene" related databases:`);
        geneDbs.forEach(db => {
            console.log(`   - ${db.title[0]?.plain_text} (${db.id})`);
            // Check parent
            if (db.parent.type === 'page_id') {
                console.log(`     Parent Page: ${db.parent.page_id}`);
            } else if (db.parent.type === 'workspace') {
                console.log(`     Parent: Workspace`);
            } else {
                console.log(`     Parent: ${db.parent.type}`);
            }
        });

        // Also listing some random others to see pattern
        console.log('\n🔍 Other random databases:');
        response.results.slice(0, 5).forEach(db => {
            const title = db.title[0]?.plain_text || 'Untitled';
            console.log(`   - ${title} (${db.id})`);
            if (db.parent.type === 'page_id') {
                console.log(`     Parent Page: ${db.parent.page_id}`);
            }
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

searchAllDatabases();
