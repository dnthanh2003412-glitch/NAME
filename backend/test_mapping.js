import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN });

const PARENT_DB_ID = '32e4b218-7829-4f9d-b06d-bbe41ea33dae';

async function testSmartMapping() {
    console.log('🚀 Testing Smart Mapping Logic...');

    // 1. Fetch All Databases
    console.log('1. Fetching first 100 visible databases...');
    const dbs = await notion.search({
        filter: { value: 'database', property: 'object' },
        page_size: 100
    });

    // 2. Fetch Active Projects
    console.log('2. Fetching Active Projects...');
    const projects = await notion.databases.query({
        database_id: PARENT_DB_ID,
        filter: {
            property: 'Status',
            status: { does_not_equal: 'Done' }
        },
        page_size: 20 // Test with 20 projects first
    });

    console.log(`   Found ${projects.results.length} active projects to test mapping.`);

    // 3. Perform Mapping
    projects.results.forEach(project => {
        let name = 'Untitled';
        if (project.properties.Name && project.properties.Name.title) {
            name = project.properties.Name.title.map(t => t.plain_text).join('');
        }

        const keywords = [name];
        // Extract [] content
        const bracketMatch = name.match(/\[(.*?)\]/);
        if (bracketMatch) {
            keywords.push(bracketMatch[1]); // e.g. DeeDee_2025_GEN
            const parts = bracketMatch[1].split('_');
            if (parts.length > 1) keywords.push(parts[parts.length - 1]); // GEN
        }

        const validKeywords = keywords.filter(k => k && k.length > 2);

        // Find Matches
        const matches = dbs.results.filter(db => {
            const dbName = db.title[0]?.plain_text || '';
            const dbNameLower = dbName.toLowerCase();

            return validKeywords.some(k => {
                const kLower = k.toLowerCase();
                return dbNameLower.includes(`[${kLower}]`) ||
                    dbNameLower.startsWith(`${kLower} `) ||
                    dbNameLower.includes(` ${kLower} `);
            });
        });

        if (matches.length > 0) {
            console.log(`\n✅ Project: ${name}`);
            console.log(`   Keywords: ${validKeywords.join(', ')}`);
            console.log(`   Mapped Databases:`);
            matches.forEach(m => console.log(`     - ${m.title[0]?.plain_text} (${m.id})`));
        }
    });
}

testSmartMapping();
