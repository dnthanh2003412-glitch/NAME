// Show full hierarchical structure of projects
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN });

const PARENT_DB_ID = '32e4b218-7829-4f9d-b06d-bbe41ea33dae';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function showHierarchicalStructure() {
    console.log('🌳 HIERARCHICAL STRUCTURE OF NOTION WORKSPACE\n');
    console.log('━'.repeat(60));

    try {
        // 1. Get parent database info
        const parentDb = await notion.databases.retrieve({ database_id: PARENT_DB_ID });
        console.log(`📁 ${parentDb.title?.[0]?.plain_text || 'Root Database'}`);
        console.log(`   ID: ${PARENT_DB_ID}`);

        // 2. Get all projects
        console.log('\n   Fetching all projects...\n');

        let allProjects = [];
        let hasMore = true;
        let startCursor = undefined;

        while (hasMore) {
            const response = await notion.databases.query({
                database_id: PARENT_DB_ID,
                start_cursor: startCursor,
                page_size: 100
            });
            allProjects = allProjects.concat(response.results);
            hasMore = response.has_more;
            startCursor = response.next_cursor;
            await sleep(350);
        }

        console.log(`   Found ${allProjects.length} projects total\n`);
        console.log('━'.repeat(60));

        // 3. For each project, get child databases
        const structure = [];
        let projectCount = 0;

        // Only process first 20 projects for demo (to save time)
        const projectsToProcess = allProjects.slice(0, 20);

        for (const project of projectsToProcess) {
            projectCount++;

            // Get project title
            let projectName = 'Untitled';
            let status = '';
            for (const [key, prop] of Object.entries(project.properties)) {
                if (prop.type === 'title') {
                    projectName = prop.title?.map(t => t.plain_text).join('') || 'Untitled';
                }
                if (prop.type === 'status') {
                    status = prop.status?.name || '';
                }
            }

            console.log(`\n📂 ${projectCount}. ${projectName}`);
            if (status) console.log(`   Status: ${status}`);
            console.log(`   ID: ${project.id}`);

            // Get child blocks
            try {
                const childBlocks = await notion.blocks.children.list({
                    block_id: project.id,
                    page_size: 50
                });

                const databases = [];
                const pages = [];

                for (const block of childBlocks.results) {
                    if (block.type === 'child_database') {
                        databases.push({
                            id: block.id,
                            title: block.child_database?.title || 'Untitled Database'
                        });
                    } else if (block.type === 'child_page') {
                        pages.push({
                            id: block.id,
                            title: block.child_page?.title || 'Untitled Page'
                        });
                    }
                }

                if (databases.length > 0) {
                    console.log(`   📊 Databases (${databases.length}):`);
                    databases.forEach(db => {
                        console.log(`      ├─ ${db.title}`);
                        console.log(`         ID: ${db.id}`);
                    });
                }

                if (pages.length > 0) {
                    console.log(`   📄 Pages (${pages.length}):`);
                    pages.forEach(page => {
                        console.log(`      ├─ ${page.title}`);
                    });
                }

                if (databases.length === 0 && pages.length === 0) {
                    console.log(`   (no child databases or pages)`);
                }

                structure.push({
                    name: projectName,
                    id: project.id,
                    status,
                    databases,
                    pages
                });

            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
            }

            await sleep(350); // Rate limit
        }

        // Summary
        console.log('\n' + '━'.repeat(60));
        console.log('\n📊 SUMMARY');
        console.log(`   Projects processed: ${structure.length}`);
        console.log(`   Projects with databases: ${structure.filter(p => p.databases.length > 0).length}`);

        const totalDatabases = structure.reduce((sum, p) => sum + p.databases.length, 0);
        console.log(`   Total child databases: ${totalDatabases}`);

        // Save structure to file
        const fs = await import('fs');
        fs.writeFileSync('./data/project_structure.json', JSON.stringify(structure, null, 2));
        console.log('\n   Structure saved to: ./data/project_structure.json');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

showHierarchicalStructure();
