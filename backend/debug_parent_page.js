// Debug: Explore parent page structure
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN });

const PARENT_PAGE_ID = '32e4b218-7829-4f9d-b06d-bbe41ea33dae';

async function exploreParentPage() {
    console.log('🔍 Exploring parent page structure...\n');

    try {
        // First, try to retrieve as a page
        console.log('1. Checking if it is a PAGE...');
        try {
            const page = await notion.pages.retrieve({ page_id: PARENT_PAGE_ID });
            console.log('   ✅ It is a PAGE');
            console.log('   Title:', page.properties?.title || page.properties?.Name || 'Unknown');
            console.log('   Parent:', page.parent);

            // Get child blocks
            console.log('\n2. Getting child blocks...');
            const blocks = await notion.blocks.children.list({
                block_id: PARENT_PAGE_ID,
                page_size: 100
            });

            console.log(`   Found ${blocks.results.length} child blocks:`);
            blocks.results.forEach((block, i) => {
                console.log(`   ${i + 1}. Type: ${block.type}, ID: ${block.id}`);
                if (block.type === 'child_database') {
                    console.log(`      Database title: ${block.child_database?.title || 'Unknown'}`);
                }
                if (block.type === 'child_page') {
                    console.log(`      Page title: ${block.child_page?.title || 'Unknown'}`);
                }
            });
        } catch (pageError) {
            console.log('   ❌ Not a page:', pageError.message);
        }

        // Try to retrieve as a database
        console.log('\n3. Checking if it is a DATABASE...');
        try {
            const db = await notion.databases.retrieve({ database_id: PARENT_PAGE_ID });
            console.log('   ✅ It is a DATABASE');
            console.log('   Title:', db.title?.[0]?.plain_text || 'Unknown');
            console.log('   Properties:', Object.keys(db.properties).join(', '));

            // Query first few records
            console.log('\n4. Querying database records...');
            const records = await notion.databases.query({
                database_id: PARENT_PAGE_ID,
                page_size: 10
            });

            console.log(`   Found ${records.results.length} records:`);
            records.results.forEach((record, i) => {
                // Get title
                let title = 'Unknown';
                for (const [key, prop] of Object.entries(record.properties)) {
                    if (prop.type === 'title') {
                        title = prop.title?.map(t => t.plain_text).join('') || 'Untitled';
                        break;
                    }
                }
                console.log(`   ${i + 1}. ${title} (${record.id})`);

                // Check if this record has child databases
                if (i < 3) { // Only check first 3
                    // Will check child blocks later
                }
            });

            // Check child blocks of first record to see structure
            if (records.results.length > 0) {
                const firstRecord = records.results[0];
                console.log('\n5. Checking child blocks of first project...');

                const childBlocks = await notion.blocks.children.list({
                    block_id: firstRecord.id,
                    page_size: 50
                });

                console.log(`   Found ${childBlocks.results.length} child blocks in first project:`);
                childBlocks.results.forEach((block, i) => {
                    console.log(`   ${i + 1}. Type: ${block.type}`);
                    if (block.type === 'child_database') {
                        console.log(`      Database: ${block.child_database?.title || 'Unknown'}`);
                    }
                    if (block.type === 'child_page') {
                        console.log(`      Page: ${block.child_page?.title || 'Unknown'}`);
                    }
                });
            }
        } catch (dbError) {
            console.log('   ❌ Not a database:', dbError.message);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

exploreParentPage();
