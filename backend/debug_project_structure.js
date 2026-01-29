// Debug: Check project structure and relations
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN });

const PARENT_DB_ID = '32e4b218-7829-4f9d-b06d-bbe41ea33dae';

async function checkProjectRelations() {
    console.log('🔍 Checking project structure and finding related databases...\n');

    try {
        // Get database schema
        const db = await notion.databases.retrieve({ database_id: PARENT_DB_ID });
        console.log('📋 Database Properties:');
        for (const [key, prop] of Object.entries(db.properties)) {
            console.log(`   - ${key} (${prop.type})`);
            if (prop.type === 'relation') {
                console.log(`     → Linked to database: ${prop.relation?.database_id}`);
            }
        }

        // Get a specific project that we know has data (Gene)
        console.log('\n🔍 Searching for Gene project...');
        const searchResults = await notion.databases.query({
            database_id: PARENT_DB_ID,
            filter: {
                property: 'Name',
                title: {
                    contains: 'Gene'
                }
            }
        });

        if (searchResults.results.length > 0) {
            const geneProject = searchResults.results[0];
            console.log('\n✅ Found Gene project:', geneProject.id);

            // Show all properties
            console.log('\n📋 Gene Project Properties:');
            for (const [key, prop] of Object.entries(geneProject.properties)) {
                console.log(`   - ${key} (${prop.type}):`, JSON.stringify(prop).substring(0, 100));
            }

            // Check child blocks
            console.log('\n🔍 Checking child blocks of Gene project...');
            const childBlocks = await notion.blocks.children.list({
                block_id: geneProject.id,
                page_size: 100
            });

            console.log(`   Found ${childBlocks.results.length} child blocks:`);
            for (const block of childBlocks.results) {
                if (block.type === 'child_database') {
                    console.log(`   📊 Database: ${block.child_database?.title} (${block.id})`);
                } else if (block.type === 'child_page') {
                    console.log(`   📄 Page: ${block.child_page?.title} (${block.id})`);
                } else {
                    console.log(`   📦 ${block.type}`);
                }
            }
        } else {
            console.log('   Gene project not found in this database');
        }

        // Also search for projects by ID pattern
        console.log('\n🔍 Searching for DeeDee_2025 projects...');
        const deeDeeResults = await notion.databases.query({
            database_id: PARENT_DB_ID,
            filter: {
                property: 'Name',
                title: {
                    contains: 'DeeDee_2025'
                }
            },
            page_size: 5
        });

        console.log(`   Found ${deeDeeResults.results.length} projects`);
        if (deeDeeResults.results.length > 0) {
            const firstProject = deeDeeResults.results[0];
            let title = '';
            for (const [key, prop] of Object.entries(firstProject.properties)) {
                if (prop.type === 'title') {
                    title = prop.title?.map(t => t.plain_text).join('') || '';
                    break;
                }
            }
            console.log(`   First: ${title}`);

            // Check child blocks
            const childBlocks = await notion.blocks.children.list({
                block_id: firstProject.id,
                page_size: 50
            });

            console.log(`   Child blocks: ${childBlocks.results.length}`);
            for (const block of childBlocks.results.slice(0, 10)) {
                if (block.type === 'child_database') {
                    console.log(`   📊 ${block.child_database?.title} (${block.id})`);
                }
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkProjectRelations();
