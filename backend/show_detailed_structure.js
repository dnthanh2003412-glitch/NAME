// Show full hierarchical structure with real database names
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN });

const PARENT_DB_ID = '32e4b218-7829-4f9d-b06d-bbe41ea33dae';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDatabaseRealName(dbId) {
    try {
        const db = await notion.databases.retrieve({ database_id: dbId });
        return db.title?.[0]?.plain_text || 'Untitled';
    } catch (e) {
        return 'Unknown';
    }
}

async function showDetailedStructure() {
    console.log('🌳 DETAILED HIERARCHICAL STRUCTURE\n');
    console.log('━'.repeat(70));

    try {
        // Get all projects with specific status (In Progress, Backlog, Planning)
        console.log('📁 [Chung]Dự án');
        console.log('   Fetching active projects...\n');

        let allProjects = [];
        let hasMore = true;
        let startCursor = undefined;

        while (hasMore) {
            const response = await notion.databases.query({
                database_id: PARENT_DB_ID,
                start_cursor: startCursor,
                page_size: 100,
                filter: {
                    property: 'Status',
                    status: {
                        does_not_equal: 'Done'
                    }
                }
            });
            allProjects = allProjects.concat(response.results);
            hasMore = response.has_more;
            startCursor = response.next_cursor;
            await sleep(350);
        }

        console.log(`   Found ${allProjects.length} active projects\n`);
        console.log('━'.repeat(70));

        const structure = [];

        for (const project of allProjects) {
            // Get project info
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

            console.log(`\n📂 ${projectName}`);
            console.log(`   Status: ${status} | ID: ${project.id.substring(0, 8)}...`);

            // Get child databases
            const childBlocks = await notion.blocks.children.list({
                block_id: project.id,
                page_size: 50
            });

            const databases = [];
            for (const block of childBlocks.results) {
                if (block.type === 'child_database') {
                    // Get real name
                    const realName = await getDatabaseRealName(block.id);
                    databases.push({
                        id: block.id,
                        title: realName
                    });
                    await sleep(200);
                }
            }

            if (databases.length > 0) {
                console.log(`   📊 Child Databases:`);
                databases.forEach((db, i) => {
                    const prefix = i === databases.length - 1 ? '└─' : '├─';
                    console.log(`      ${prefix} ${db.title}`);
                    console.log(`         ID: ${db.id}`);
                });
            } else {
                console.log(`   (no child databases)`);
            }

            structure.push({
                name: projectName,
                id: project.id,
                status,
                databases
            });

            await sleep(350);
        }

        // Summary
        console.log('\n' + '━'.repeat(70));
        console.log('\n📊 SUMMARY');
        console.log(`   Active projects: ${structure.length}`);
        console.log(`   Projects with databases: ${structure.filter(p => p.databases.length > 0).length}`);

        const totalDatabases = structure.reduce((sum, p) => sum + p.databases.length, 0);
        console.log(`   Total child databases: ${totalDatabases}`);

        // Save structure
        const fs = await import('fs');
        fs.writeFileSync('./data/active_project_structure.json', JSON.stringify(structure, null, 2));
        console.log('\n   Structure saved to: ./data/active_project_structure.json');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

showDetailedStructure();
