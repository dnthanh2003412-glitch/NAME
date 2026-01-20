import { BaseReport } from './base-report.js';
import fs from 'fs';

/**
 * Sprint Report
 * Calculates task points by sprint and assignee
 */
export class SprintReport extends BaseReport {
    constructor() {
        super('sprint', 'Báo Cáo Sprint');
    }

    calculate(rawData) {
        // Flatten all records from all databases
        const allRecords = Object.values(rawData).flat();

        // 1. Build ID -> Name Map to resolve Relations
        // 1. Build ID -> Name Map to resolve Relations
        const idToNameMap = new Map();

        // Debug counters
        let mappedCount = 0;
        let sprintCount = 0;
        let productCount = 0;

        for (const record of allRecords) {
            if (!record.properties) continue;

            // Smart Title Detection
            // 1. Try exact matches first
            let name = this.getProperty(record, 'Name') ||
                this.getProperty(record, 'Title') ||
                this.getProperty(record, 'Tên') ||
                this.getProperty(record, 'Tên task');

            // 2. If null, try case-insensitive search for keywords
            if (!name) {
                const lowerProps = Object.keys(record.properties).reduce((acc, key) => {
                    acc[key.toLowerCase()] = record.properties[key];
                    return acc;
                }, {});

                name = lowerProps['name'] ||
                    lowerProps['title'] ||
                    lowerProps['sprint name'] ||
                    lowerProps['product name'] ||
                    lowerProps['tên'];
            }

            // 3. Fallback: Use the record's ID as name if nothing found? No, better to leave undefined
            // But we need to distinguish Sprints and Products.

            // If we found a name, store it
            if (name) {
                // If it's a huge string (rich text), format it? Fetcher already does that.
                idToNameMap.set(record.id, name);
                mappedCount++;

                // Heuristic to guess type for debug
                if (record.database_name?.toLowerCase().includes('sprint')) sprintCount++;
                if (record.database_name?.toLowerCase().includes('product')) productCount++;
            }
        }

        console.log(`[SprintReport] Mapped ${mappedCount} items (Sprints: ~${sprintCount}, Products: ~${productCount})`);

        // --- DEBUG: Dump data to file to investigate property names ---
        try {
            // fs is imported at top level
            const debugPath = 'C:\\Users\\Datpq\\.gemini\\antigravity\\brain\\112f6963-d7a0-4f46-8b0b-508d637e5ca4\\report_debug.json';
            const debugData = {
                mappedCount,
                sampleMap: Array.from(idToNameMap.entries()).slice(0, 50),
                sampleRecords: allRecords.slice(0, 10).map(r => ({
                    id: r.id,
                    db: r.database_name,
                    props: Object.keys(r.properties || {})
                }))
            };
            fs.writeFileSync(debugPath, JSON.stringify(debugData, null, 2));
            console.log('[SprintReport] Wrote debug data to', debugPath);
        } catch (e) { console.error('[SprintReport] Debug write failed', e); }
        // -------------------------------------------------------------

        const grouped = {};

        for (const record of allRecords) {
            // Only process items that look like tasks (have Status or Points)
            // or we process everything and if it lacks fields it goes to "Others"
            // But usually we filter for tasks. For now, we process all and see.

            // Extract Project (Dự án) - use project_name which groups databases
            let project = record.project_name || record.database_name || 'Unknown Project';

            // Extract Product from Product column
            let product = this.resolveValue(record, ['Product', 'Sản phẩm'], idToNameMap) || 'No Product';

            // Extract Sprint
            let sprint = this.resolveValue(record, ['Sprint', 'Đợt'], idToNameMap) || 'No Sprint';

            // Extract Assignee (Người thực hiện)
            let assignee = this.extractAssigneeName(record);

            // Extract Task Points
            const points = parseFloat(this.getProperty(record, 'Task point') ||
                this.getProperty(record, 'task_point') ||
                this.getProperty(record, 'Point') ||
                this.getProperty(record, 'Points') ||
                this.getProperty(record, 'Product point')) || 0;

            // Extract Status
            const status = this.getProperty(record, 'Status') ||
                this.getProperty(record, 'status') ||
                this.getProperty(record, 'Trạng thái') || '';

            const isConfirmed = status.toLowerCase().includes('done') ||
                status.toLowerCase().includes('ok') ||
                status.toLowerCase().includes('confirmed') ||
                status.toLowerCase().includes('approved') || // Added Approved
                status.toLowerCase().includes('hoàn thành'); // Vietnamese support

            // Grouping Structure: grouped[project][sprint][assignee]
            if (!grouped[project]) grouped[project] = {};
            if (!grouped[project][sprint]) grouped[project][sprint] = {};

            if (!grouped[project][sprint][assignee]) {
                grouped[project][sprint][assignee] = {
                    confirmed: 0,
                    unconfirmed: 0,
                    total: 0,
                    products: new Set()
                };
            }

            // Track products
            if (product !== 'No Product') {
                grouped[project][sprint][assignee].products.add(product);
            }

            grouped[project][sprint][assignee].confirmed += isConfirmed ? points : 0;
            grouped[project][sprint][assignee].unconfirmed += isConfirmed ? 0 : points;
            grouped[project][sprint][assignee].total += points;
        }

        return grouped;
    }

    /**
     * Helper to resolve property value, handling Selects and Relations (via Map)
     */
    resolveValue(record, keys, idToNameMap) {
        for (const key of keys) {
            const val = this.getProperty(record, key);
            if (!val) continue;

            // If array (Relation or Multi-select)
            if (Array.isArray(val)) {
                if (val.length === 0) continue;
                // Try to map IDs to Names if they look like IDs (uuid validation or just check map)
                const mapped = val.map(item => {
                    // Item could be a string ID (Relation) or string Name (Multi-select from fetcher)
                    // Fetcher returns IDs for relations.
                    if (idToNameMap.has(item)) return idToNameMap.get(item);
                    return item; // Assume it's already a name if not in map
                });
                return mapped.join(', ');
            }

            // If single value
            if (idToNameMap.has(val)) return idToNameMap.get(val);
            return val;
        }
        return null;
    }

    extractAssigneeName(record) {
        const people = this.getProperty(record, 'Assignee') ||
            this.getProperty(record, 'assignee') ||
            this.getProperty(record, 'Owner') || // Added Owner
            this.getProperty(record, 'Người làm') ||
            this.getProperty(record, 'Người thực hiện');

        return this.getFirstPersonName(people);
    }

    format(calculatedData) {
        // Flatten for frontend: [{ project, sprint, assignee, confirmed_points, ... }]
        const result = [];

        for (const [project, sprints] of Object.entries(calculatedData)) {
            for (const [sprint, assignees] of Object.entries(sprints)) {
                for (const [assignee, stats] of Object.entries(assignees)) {
                    // Filter out rows with 0 points if desired, but user might want to see them.
                    // Let's keep them if they exist in the grouping.
                    if (stats.total === 0) continue;

                    result.push({
                        project,
                        sprint,
                        assignee,
                        product: Array.from(stats.products).join(', '),
                        confirmed_points: stats.confirmed,
                        unconfirmed_points: stats.unconfirmed,
                        total_points: stats.total
                    });
                }
            }
        }

        // Sort: Project -> Sprint -> Assignee
        result.sort((a, b) => {
            if (a.project !== b.project) return a.project.localeCompare(b.project);
            if (a.sprint !== b.sprint) return a.sprint.localeCompare(b.sprint);
            return a.assignee.localeCompare(b.assignee);
        });

        // Limit to 1000 rows to prevent browser freeze
        if (result.length > 1000) {
            console.warn(`[SprintReport] Data too large (${result.length} rows), limiting to 1000`);
            return result.slice(0, 1000);
        }

        return result;
    }
}
