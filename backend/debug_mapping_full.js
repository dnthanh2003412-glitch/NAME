import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN });
const PARENT_DB_ID = '32e4b218-7829-4f9d-b06d-bbe41ea33dae';

// Copy logic from projects.js
async function getAllVisibleDatabases() {
    let allDatabases = [];
    let hasMore = true;
    let startCursor = undefined;
    console.log('Fetching ALL databases (this might take time)...');

    try {
        while (hasMore) {
            const response = await notion.search({
                filter: { value: 'database', property: 'object' },
                start_cursor: startCursor,
                page_size: 100
            });

            allDatabases = allDatabases.concat(response.results);
            hasMore = response.has_more;
            startCursor = response.next_cursor;
            process.stdout.write('.');
        }
    } catch (e) {
        console.log(`\n⚠️ Search stopped early: ${e.message}`);
        // Continue with what we have
    }

    console.log(`\nFound ${allDatabases.length} total databases.`);
    return allDatabases.map(db => ({
        id: db.id,
        name: db.title?.[0]?.plain_text || 'Untitled'
    }));
}

function extractProjectInfo(project) {
    let name = 'Untitled';
    if (project.properties.Name && project.properties.Name.title) {
        name = project.properties.Name.title.map(t => t.plain_text).join('');
    }

    const keywords = [name];

    // 1. Bracket content [Code]
    const bracketMatch = name.match(/\[(.*?)\]/);
    if (bracketMatch) {
        keywords.push(bracketMatch[1]); // e.g. DeeDee_2026_LEG
        const parts = bracketMatch[1].split('_');
        if (parts.length > 1) {
            keywords.push(parts[parts.length - 1]); // LEG
        }
    }

    // 2. Name after brackets
    // [Code] Real Name -> Real Name
    const nameAfterBracket = name.replace(/\[.*?\]\s*/, '').trim();
    if (nameAfterBracket.length > 0) {
        keywords.push(nameAfterBracket);

        // Split words -> "NINJAGO LEGO ZOOM" -> "NINJAGO", "LEGO", "ZOOM"
        if (nameAfterBracket.includes(' ')) {
            // First word if long enough
            const words = nameAfterBracket.split(' ');
            words.forEach(w => {
                if (w.length > 3) keywords.push(w);
            });

            // First two words combined
            if (words.length >= 2) {
                keywords.push(`${words[0]} ${words[1]}`);
            }
        }
    }

    // 3. Known Aliases
    if (name.includes("Harry")) keywords.push("Harry");
    if (name.includes("Gene")) keywords.push("Gene");
    if (name.includes("Mami")) keywords.push("Mami");
    if (name.toLowerCase().includes("lego")) keywords.push("Lego");

    return { name, keywords: [...new Set(keywords)].filter(k => k && k.length > 2) };
}

function findMatchingDatabases(projectInfo, allDatabases) {
    return allDatabases.filter(db => {
        const dbNameLower = db.name.toLowerCase();

        // Skip parent DB
        if (db.id === PARENT_DB_ID) return false;

        return projectInfo.keywords.some(keyword => {
            const k = keyword.toLowerCase();
            return dbNameLower.includes(`[${k}]`) ||
                dbNameLower.startsWith(`${k} `) ||
                dbNameLower.includes(` ${k} `);
        });
    });
}

async function debugMapping() {
    console.log('--- DEBUG MAPPING ---');

    const allDbs = await getAllVisibleDatabases();

    const WHITELIST = [
        'Disk Knight', 'SHAVUOT', 'NINJAGO LEGO ZOOM', 'FC MOBILE',
        'HARRY & THE MUTANT', 'MIRACULOUS CHIBI TVC', 'XANHSM BUMPER ADS',
        'KNIGHTS OF GUINEVERE', 'GENEVIEVE', 'Sunny Side Down',
        'Đại Hiệp Văn Sử', 'UPZI', 'LEGO ZOOM', 'Victory Harben',
        'Immortals', 'Mami Fatale'
    ];

    const projects = await notion.databases.query({
        database_id: PARENT_DB_ID,
        filter: {
            property: 'Status',
            status: { does_not_equal: 'Done' }
        }
    });

    console.log('\n--- CHECKING WHITELISTED PROJECTS ---');

    for (const p of projects.results) {
        const info = extractProjectInfo(p);

        // Only check whitelist related projects
        if (!WHITELIST.some(w => info.name.toLowerCase().includes(w.toLowerCase()))) continue;

        const matches = findMatchingDatabases(info, allDbs);

        console.log(`\nProject: ${info.name}`);
        console.log(`Keywords: ${info.keywords.join(', ')}`);

        if (matches.length === 0) {
            console.log('   ❌ NO DATABASES FOUND!');
            // Suggest
            const candidates = allDbs.filter(d => d.name.toLowerCase().includes(info.keywords[0].split(' ')[0].toLowerCase().substring(0, 3)));
            if (candidates.length > 0 && candidates.length < 5) {
                console.log('   Possible candidates (by prefix):');
                candidates.forEach(c => console.log(`      - ${c.name}`));
            }
        } else {
            console.log(`   ✅ Found ${matches.length} databases:`);
            matches.forEach(m => console.log(`      - ${m.name}`));
        }
    }
}

debugMapping();
