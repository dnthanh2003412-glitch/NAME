import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN });
const PARENT_DB_ID = '32e4b218-7829-4f9d-b06d-bbe41ea33dae';

async function findChildDatabases() {
    console.log('--- FINDING PROJECT CHILDREN ---');

    // 1. Get a specific project to test (e.g. Gene or Lego)
    const projects = await notion.databases.query({
        database_id: PARENT_DB_ID,
        filter: {
            property: 'Name',
            title: {
                contains: 'GENEVIEVE'
            }
        }
    });

    if (projects.results.length === 0) {
        console.log('Project not found');
        return;
    }

    const project = projects.results[0];
    const projectName = project.properties.Name.title[0]?.plain_text;
    console.log(`Testing Project: ${projectName} (${project.id})`);

    try {
        // 2. Fetch Children Blocks
        const children = await notion.blocks.children.list({
            block_id: project.id,
            page_size: 100
        });

        console.log(`Found ${children.results.length} blocks.`);

        let foundDbs = 0;
        for (const block of children.results) {
            if (block.type === 'child_database') {
                console.log(`✅ Found Inline Database: ${block.child_database.title} (${block.id})`);
                foundDbs++;
            } else if (block.type === 'child_page') {
                console.log(`   Found Child Page: ${block.child_page.title}`);
            } else if (block.type === 'link_to_page' && block.link_to_page.type === 'database_id') {
                console.log(`✅ Found Linked Database: ${block.link_to_page.database_id}`);
                foundDbs++;
                // We need to fetch details to get name
                const db = await notion.databases.retrieve({ database_id: block.link_to_page.database_id });
                console.log(`   -> Name: ${db.title[0]?.plain_text}`);
            } else if (block.has_children) {
                console.log(`   Block type ${block.type} has children (might contain nested dbs)`);
            }
        }

        if (foundDbs === 0) {
            console.log('❌ No direct database blocks found in this project page.');
            console.log('   (User might have placed them in toggles or columns - Logic needs recursive fetch)');
        }

    } catch (e) {
        console.error('⚠️ Error fetching children:', e.code, e.message);
    }
}

findChildDatabases();
