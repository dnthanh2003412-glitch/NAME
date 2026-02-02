import { SENIORITY_MAPPING, KPI_MAPPING, PRODUCT_TYPE_MAPPING, NAME_ALIAS_MAPPING } from '../constants.js';

export class ProductivityService {
    constructor(db) {
        this.db = db;
    }

    /**
     * Generate Productivity Report
     * @param {string} startDate - Format "YYYY-MM-DD"
     * @param {string} endDate - Format "YYYY-MM-DD"
     * @param {Array<string>} databaseIds 
     */
    async generateReport(startDate, endDate, databaseIds) {
        const stats = this.getStats(startDate, endDate); // Helper to get Manual Inputs
        const reportData = [];
        
        // Parse date range
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        if (end) {
            end.setHours(23, 59, 59, 999);
        }

        // 1. Collect all data
        let allTasks = [];
        for (const dbId of databaseIds) {
            const data = this.db.getData(dbId);
            allTasks = allTasks.concat(data);
        }

        // 2. Filter by Date Range and Status
        const relevantTasks = allTasks.filter(task => {
            const status = this.getPropertyValue(task, 'Task Status') || this.getPropertyValue(task, 'Status');
            // Use robust date parsing
            const doneDate = this.parseDate(task);

            // Check Status = Done
            if (String(status).toLowerCase() !== 'done') return false;

            // Check Date Range
            if (!doneDate) return false;
            
            // doneDate is a Date object now
            if (start && doneDate < start) return false;
            if (end && doneDate > end) return false;

            return true;
        });

        // 3. Group by Assignee
        const grouped = {};
        for (const task of relevantTasks) {
            const assignees = this.getAssignees(task);
            for (const person of assignees) {
                if (!grouped[person]) grouped[person] = [];
                grouped[person].push(task);
            }
        }

        // 4. Build Rows per Assignee - use ACTUAL assignees from data
        // Also include preset list for any that haven't appeared
        const assigneesFromData = Object.keys(grouped);
        const presetPersonnel = Object.keys(SENIORITY_MAPPING);

        // Combine: data assignees first, then any preset not in data
        const allPersonnel = [...assigneesFromData];
        for (const preset of presetPersonnel) {
            if (!grouped[preset]) {
                allPersonnel.push(preset);
            }
        }

        for (const personName of allPersonnel) {
            // Try to find seniority - exact match first, then fuzzy
            let seniority = SENIORITY_MAPPING[personName];
            if (!seniority) {
                // Try case-insensitive/partial match
                const lowerName = personName.toLowerCase();
                const match = presetPersonnel.find(p =>
                    p.toLowerCase() === lowerName ||
                    p.toLowerCase().includes(lowerName) ||
                    lowerName.includes(p.toLowerCase())
                );
                seniority = match ? SENIORITY_MAPPING[match] : 'Chưa xác định';
            }

            const kpi = KPI_MAPPING[seniority] || 0;
            const tasks = grouped[personName] || [];

            // Manual Inputs
            const standardDays = stats.standard_days || 0;
            const actualDays = stats.actual_days?.[personName] || 0;

            // Calculate Metrics
            const metrics = this.calculateMetrics(tasks, kpi, standardDays, actualDays);

            reportData.push({
                fullName: personName,
                seniority,
                productivityReq: kpi,
                standardDays,
                actualDays,
                taskCount: tasks.length,  // Total tasks for this person
                ...metrics
            });
        }

        const validData = reportData.filter(r => r.seniority !== 'Chưa xác định');
        
        // For unknown users, just return name and task count (no task details)
        const unknownUsers = reportData
            .filter(r => r.seniority === 'Chưa xác định')
            .map(r => ({
                name: r.fullName,
                taskCount: r.taskCount
            }));

        return { validData, unknownUsers };
    }

    calculateMetrics(tasks, kpi, standardDays, actualDays) {
        // C6: Task point req
        const pointReq = kpi * actualDays * 2;

        let effortConf = 0;   // C7
        let effortUnconf = 0; // C8
        let pointConf = 0;    // C10
        let pointUnconf = 0;  // C11

        for (const task of tasks) {
            // Filter: Only "Product Type" == "Chuyên môn" counts for points/effort
            const pType = this.getPropertyValue(task, 'Product Type', 'PRODUCT TYPE', 'product type');
            const classification = PRODUCT_TYPE_MAPPING[pType];

            if (classification !== 'Chuyên môn') continue;

            const pointStatus = this.getPropertyValue(task, 'Point Status', 'POINT STATUS', 'point status');

            // Task points - try multiple property names
            const pointVal = parseFloat(this.getPropertyValue(task, 'TP thực tế', 'TP THỰC TẾ', 'Task Point', 'TASK POINT') || 0);
            // Effort - try multiple property names  
            const effortVal = parseFloat(this.getPropertyValue(task, 'NLTT', 'nltt', 'Actual Effort', 'actual effort') || 0);

            if (String(pointStatus).toLowerCase() === 'confirmed') {
                effortConf += effortVal;
                pointConf += pointVal;
            } else if (String(pointStatus).toLowerCase() === 'unconfirmed') {
                effortUnconf += effortVal;
                pointUnconf += pointVal;
            }
        }

        const effortTotal = effortConf + effortUnconf; // C9
        const pointTotal = pointConf + pointUnconf;    // C12

        // Ratios
        const productivityConf = effortConf ? (pointConf / effortConf) : 0; // C13 (N)
        const productivityUnconf = effortUnconf ? (pointUnconf / effortUnconf) : 0; // C14 (O)
        const productivityTotal = effortTotal ? (pointTotal / effortTotal) : 0; // C15 (P)

        // Q: Completion Productvity Confirmed = Col 10 / Col 7. Same as C13.
        const completionProdConf = effortConf ? (pointConf / effortConf) : 0; // C16 (Q)

        // R: Completion Productivity Total
        // User req: "R = cột 12 / cột 11" (Point Total / Point Unconfirmed). 
        const completionProdTotal = pointUnconf ? (pointTotal / pointUnconf) : 0; // C17 (R)

        const completionPointConf = pointReq ? (pointConf / pointReq) : 0; // C18 (S)
        const completionPointTotal = pointReq ? (pointTotal / pointReq) : 0; // C19 (T)

        const effortRatio = (actualDays * 2) ? (effortTotal / (actualDays * 2)) : 0; // C20 (U) - Updated to use actualDays

        return {
            pointReq,
            effortConfirmed: effortConf,
            effortUnconfirmed: effortUnconf,
            effortTotal,
            pointConfirmed: pointConf,
            pointUnconfirmed: pointUnconf,
            pointTotal,
            productivityConfirmed: productivityConf,
            productivityUnconfirmed: productivityUnconf,
            productivityTotal,
            completionProdConfirmed: completionProdConf,
            completionProdTotal,
            completionPointConfirmed: completionPointConf,
            completionPointTotal,
            effortRatio
        };
    }

    /**
     * Get property value with case-insensitive fallback
     * Tries exact match first, then case-insensitive search
     */
    getPropertyValue(task, ...propNames) {
        const props = task.properties;
        if (!props) return null;

        // Try each property name in order
        for (const propName of propNames) {
            // 1. Try exact match first
            let value = props[propName];

            // 2. If not found, try case-insensitive match
            if (value === null || value === undefined) {
                const lowerName = propName.toLowerCase();
                const matchingKey = Object.keys(props).find(k => k.toLowerCase() === lowerName);
                if (matchingKey) {
                    value = props[matchingKey];
                }
            }

            // If found, extract and return
            if (value !== null && value !== undefined) {
                return this.extractValue(value);
            }
        }

        return null;
    }

    /**
     * Extract actual value from Notion's nested structure
     */
    extractValue(value) {
        if (value === null || value === undefined) return null;

        // Handle array with nested objects (common in Notion rollups/formulas/relations)
        if (Array.isArray(value)) {
            if (value.length === 0) return null;
            
            // Check if it's an array of relation objects (have 'id' property)
            // Relations look like: [{id: "xxx-xxx"}, {id: "yyy-yyy"}]
            if (value[0] && typeof value[0] === 'object') {
                const first = value[0];
                
                // Formula wrapper
                if (first.type === 'formula' && first.formula) {
                    const f = first.formula;
                    return f.string ?? f.number ?? f.boolean ?? null;
                }
                // Select wrapper
                if (first.type === 'select' && first.select) {
                    return first.select.name || null;
                }
                // Status wrapper
                if (first.type === 'status' && first.status) {
                    return first.status.name || null;
                }
                // Number wrapper
                if (first.type === 'number') {
                    return first.number;
                }
                // Title/rich_text - extract plain text
                if (first.type === 'text' || first.plain_text !== undefined) {
                    return value.map(v => v.plain_text || '').join('');
                }
                // Relation - extract titles if available, otherwise return names from rollup
                if (first.id && !first.type) {
                    // This is a relation array - just IDs, will be handled by formatValue
                    return value;
                }
            }
            
            // Array of primitives
            if (typeof value[0] !== 'object') {
                return value.join(', ');
            }
        }

        return value;
    }

    /**
     * Format value for display - handle objects, arrays, etc.
     */
    formatValue(value) {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'string') return value || '-';
        if (typeof value === 'number') return String(value);
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        
        // Handle date object
        if (value instanceof Date) {
            return value.toLocaleDateString('vi-VN');
        }
        
        // Handle object with start/end (date range)
        if (typeof value === 'object' && !Array.isArray(value) && (value.start || value.end)) {
            const dateStr = value.end || value.start;
            if (dateStr) {
                const d = new Date(dateStr);
                return !isNaN(d.getTime()) ? d.toLocaleDateString('vi-VN') : dateStr;
            }
            return '-';
        }
        
        // Handle array (relations, rollups, multi-select)
        if (Array.isArray(value)) {
            if (value.length === 0) return '-';
            
            // Check if it's an array of UUIDs (relation IDs) - these can't be resolved to names
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (typeof value[0] === 'string' && uuidRegex.test(value[0])) {
                return '-'; // Can't display relation IDs, need rollup for names
            }
            
            // Check what type of array items we have
            const results = value.map(item => {
                if (item === null || item === undefined) return '';
                if (typeof item === 'string') {
                    // Skip UUID strings
                    if (uuidRegex.test(item)) return null;
                    return item;
                }
                if (typeof item === 'number') return String(item);
                
                // Object with various possible structures
                if (typeof item === 'object') {
                    // Has name (select, multi-select, status)
                    if (item.name) return item.name;
                    // Has title (relation with title rollup)
                    if (item.title) {
                        if (Array.isArray(item.title)) {
                            return item.title.map(t => t.plain_text || '').join('');
                        }
                        return item.title;
                    }
                    // Has plain_text (rich text)
                    if (item.plain_text !== undefined) return item.plain_text;
                    // Relation object with just ID - skip (can't resolve without API call)
                    if (item.id && Object.keys(item).length <= 2) return null;
                    // Nested object
                    return this.formatValue(item);
                }
                return '';
            }).filter(v => v !== null && v !== '');
            
            return results.length > 0 ? results.join(', ') : '-';
        }
        
        // Handle object with name property (select, status)
        if (typeof value === 'object' && value.name) {
            return value.name;
        }
        
        // Handle object with title property
        if (typeof value === 'object' && value.title) {
            if (Array.isArray(value.title)) {
                return value.title.map(t => t.plain_text || '').join('');
            }
            return String(value.title);
        }
        
        // Handle object with plain_text
        if (typeof value === 'object' && value.plain_text !== undefined) {
            return value.plain_text || '-';
        }
        
        // Fallback for unknown objects
        if (typeof value === 'object') {
            // Try to extract any meaningful string
            const str = JSON.stringify(value);
            // If it's just an ID object, return dash
            if (str.includes('"id"') && !str.includes('"name"') && !str.includes('"title"')) {
                return '-';
            }
        }
        
        return '-';
    }

    /**
     * Parse date from DoneDate column (priority) or fallback columns
     * Returns null if column is empty - those tasks will be skipped
     */
    parseDate(task) {
        const props = task.properties;
        if (!props) return null;

        // Find date column - prioritize DoneDate
        let dateValue = null;
        const dateKeys = ['DoneDate', 'Done Date', 'DONE DATE', 'Ngày làm', 'Ngay lam', 'NGÀY LÀM', 'ngày làm', 'Work Date'];

        for (const key of dateKeys) {
            if (props[key] !== null && props[key] !== undefined) {
                dateValue = props[key];
                break;
            }
        }

        // Also try case-insensitive search
        if (!dateValue) {
            const matchingKey = Object.keys(props).find(k =>
                k.toLowerCase() === 'donedate' ||
                k.toLowerCase() === 'done date' ||
                k.toLowerCase().includes('ngày') ||
                k.toLowerCase().includes('ngay') ||
                k.toLowerCase() === 'work date'
            );
            if (matchingKey) {
                dateValue = props[matchingKey];
            }
        }

        if (!dateValue) return null;

        // Handle object format: {start: "2025-01-15", end: "2025-01-20"}
        // Use END date as completion date, fallback to start
        if (typeof dateValue === 'object') {
            const dateStr = dateValue.end || dateValue.start;
            if (dateStr) {
                return new Date(dateStr);
            }
            return null;
        }

        // Handle string format
        if (typeof dateValue === 'string') {
            return this.parseStringDate(dateValue);
        }

        return null;
    }

    /**
     * Parse string date in various formats
     */
    parseStringDate(rawDate) {
        if (!rawDate) return null;
        rawDate = rawDate.trim();

        // ISO Date (YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
            return new Date(rawDate);
        }

        // DD/MM/YYYY or DD-MM-YYYY
        const ddmmyyyy = rawDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (ddmmyyyy) {
            const day = parseInt(ddmmyyyy[1]);
            const month = parseInt(ddmmyyyy[2]) - 1;
            const year = parseInt(ddmmyyyy[3]);
            return new Date(year, month, day);
        }

        // Fallback: Let JS Date constructor try
        const fallback = new Date(rawDate);
        if (!isNaN(fallback.getTime())) return fallback;

        return null;
    }

    // Deprecated but kept for compatibility if needed (aliased to parseDate)
    getDataDate(task) {
        return this.parseDate(task);
    }

    getAssignees(task) {
        // Try Assignee first, then Owner as fallback
        let assignees = task.properties?.['Assignee'] || task.properties?.['Owner'] || task.properties?.['assignee'] || task.properties?.['owner'];
        if (!assignees) return [];

        // Data is already transformed to array of {id, name, email}
        if (Array.isArray(assignees)) {
            return assignees.map(p => {
                const rawName = (p.name || '').trim();
                if (!rawName) return '';

                // Resolve alias: Notion short name → full name
                // If found in alias mapping, use full name; otherwise keep original
                return NAME_ALIAS_MAPPING[rawName] || rawName;
            }).filter(n => n);
        }
        return [];
    }

    // Stats Management for Inputs
    // Now uses date range key like "2024-01-01_2024-01-31"
    getStats(startDate, endDate) {
        const key = `${startDate || 'all'}_${endDate || 'all'}`;
        const meta = this.db.getMetadata('monthly_stats') || {};
        return meta[key] || { standard_days: 0, actual_days: {} };
    }

    updateStats(startDate, endDate, updates) {
        const key = `${startDate || 'all'}_${endDate || 'all'}`;
        const meta = this.db.getMetadata('monthly_stats') || {};
        if (!meta[key]) meta[key] = { standard_days: 0, actual_days: {} };

        if (updates.standard_days !== undefined) meta[key].standard_days = parseFloat(updates.standard_days);
        if (updates.actual_days) {
            meta[key].actual_days = { ...meta[key].actual_days, ...updates.actual_days };
        }

        this.db.setMetadata('monthly_stats', meta);
        return meta[key];
    }
}
