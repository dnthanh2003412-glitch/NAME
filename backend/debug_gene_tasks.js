import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_TOKEN });

const GENE_TASKS_DB_ID = '28fccb0e-ac88-81f7-9773-d350b2f7eb6e'; // Gene Products
const GENE_PROJECT_ID = '28fccb0e-ac88-809d-9d36-e2584a27034a';

async function checkRelations() {
    console.log('🔍 Checking [Gene] PRODUCT database relations...');

    try {
        const db = await notion.databases.retrieve({ database_id: GENE_TASKS_DB_ID });
        console.log(`\nDatabase: ${db.title[0]?.plain_text}`);

        console.log('\n📋 Properties checking for Relations:');
        let foundRelation = false;

        for (const [key, prop] of Object.entries(db.properties)) {
            if (prop.type === 'relation') {
                console.log(`   🔸 ${key} (relation) -> DB: ${prop.relation.database_id}`);

                // [Chung]Dự án database ID
                if (prop.relation.database_id === '32e4b218-7829-4f9d-b06d-bbe41ea33dae') {
                    console.log(`      ✅ FOUND LINK TO [Chung]Dự án! Field: "${key}"`);
                    foundRelation = true;
                }
            }
        }

        if (!foundRelation) {
            console.log('\n❌ No relation to [Chung]Dự án found directly in schema.');
        }

        // Now fetch one task and see what the relation value is
        console.log('\n🔍 Fetching one task to see relation values...');
        const response = await notion.databases.query({
            database_id: GENE_TASKS_DB_ID,
            page_size: 1
        });

        if (response.results.length > 0) {
            const task = response.results[0];
            for (const [key, prop] of Object.entries(task.properties)) {
                if (prop.type === 'relation' && prop.relation.length > 0) {
                    console.log(`   🔹 ${key}: ${JSON.stringify(prop.relation)}`);

                    const isLinkedToProject = prop.relation.some(r => r.id.replaceAll('-', '') === GENE_PROJECT_ID.replaceAll('-', ''));
                    if (isLinkedToProject) {
                        console.log(`      🎯 MATCH! Field "${key}" points to Gene Project ID!`);
                    }
                }
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkRelations();
