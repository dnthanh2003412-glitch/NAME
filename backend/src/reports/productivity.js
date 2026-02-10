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
        console.log(`[Productivity] Processing ${allTasks.length} total tasks from ${databaseIds.length} DBs.`);

        // Debug Counters
        let countStatusReject = 0;
        let countDateMissing = 0;
        let countDateRangeReject = 0;
        let countAssigneeMissing = 0;
        let countAccepted = 0;
        let missingDateSamples = [];
        let projectsSet = new Set();

        const relevantTasks = allTasks.filter(task => {
            const status = this.getPropertyValue(task, 'Task Status') || this.getPropertyValue(task, 'Status');
            const statusLower = String(status).toLowerCase();
            const isDone = statusLower === 'done' || statusLower === 'done qc' || statusLower === 'done others';

            // Check Status
            if (!isDone) {
                countStatusReject++;
                return false;
            }

            // Parse Date
            const doneDate = this.parseDate(task);

            // Check Date Missing
            if (!doneDate) {
                countDateMissing++;
                // DEBUG: Analyze why date is missing for Done tasks
                if (missingDateSamples.length < 5) {
                    const propKeys = Object.keys(task.properties).join(', ');
                    missingDateSamples.push({
                        name: this.getPropertyValue(task, 'Name'),
                        project: task.database_name,
                        props: propKeys
                    });
                    console.log(`[DEBUG_DATE_MISSING] Task: "${this.getPropertyValue(task, 'Name')}" | Project: ${task.database_name} | Props: ${propKeys}`);
                }
                return false;
            }

            // Check Date Range
            let inRange = false;
            if ((!start || doneDate >= start) && (!end || doneDate <= end)) {
                inRange = true;
            }

            if (!inRange) {
                countDateRangeReject++;
                return false;
            }

            // Check Assignee
            const assignees = this.getAssignees(task);
            if (assignees.length === 0) {
                countAssigneeMissing++;
                // Still keep it? No, grouping will put it in undefined?
                // The logic below groups by assignee. If empty, it's lost?
                // Actually loop 3 iterates assignees. If empty, task is ignored.
            }

            countAccepted++;
            projectsSet.add(task.database_name);
            return true;
        });

        console.log(`[Productivity] Filter Stats:`);
        console.log(`- Total Accepted: ${countAccepted}`);
        console.log(`- Rejected (Status != Done): ${countStatusReject}`);
        console.log(`- Rejected (Date Missing/Invalid): ${countDateMissing}`);
        console.log(`- Rejected (Date Out of Range): ${countDateRangeReject}`);
        console.log(`- Missing Assignee (Potential Loss): ${countAssigneeMissing} (Included in Accepted but might be lost in grouping)`);

        console.log(`[Productivity] Metrics calculated. Relevant Tasks: ${relevantTasks.length}`);

        // 3. Group by Assignee
        const grouped = {};
        for (const task of relevantTasks) {
            const assignees = this.getAssignees(task);

            for (const person of assignees) {
                if (!grouped[person]) grouped[person] = [];
                grouped[person].push(task);
            }
        }

        // 4. Build Rows per Assignee
        const assigneesFromData = Object.keys(grouped);
        const presetPersonnel = Object.keys(SENIORITY_MAPPING);
        // reportData is already declared at top

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
                const knownNames = Object.keys(SENIORITY_MAPPING);
                const normalizedRaw = this.removeAccents(personName.toLowerCase());

                const match = knownNames.find(known => {
                    const normalizedKnown = this.removeAccents(known.toLowerCase());
                    return normalizedRaw.includes(normalizedKnown) || normalizedKnown.includes(normalizedRaw);
                });
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

        // For unknown users, just return name and task count
        const unknownUsers = reportData
            .filter(r => r.seniority === 'Chưa xác định')
            .map(r => ({
                name: r.fullName,
                taskCount: r.taskCount
            }));

        const filterStats = {
            totalProcessed: allTasks.length,
            totalAccepted: countAccepted,
            rejectedStatus: countStatusReject,
            rejectedDateMissing: countDateMissing,
            rejectedDateRange: countDateRangeReject,
            missingAssignee: countAssigneeMissing,
            missingDateSamples: missingDateSamples || [],
            projects: Array.from(projectsSet)
        };

        return { validData, unknownUsers, filterStats };
    }

    calculateMetrics(tasks, kpi, standardDays, actualDays) {
        // C6: Task point req
        const pointReq = kpi * actualDays * 2;

        let effortConf = 0;   // C7
        let effortUnconf = 0; // C8
        let pointConf = 0;    // C10
        let pointUnconf = 0;  // C11

        for (const task of tasks) {
            // All products count, no Product Type filter
            // Only separate by Point Status: Confirmed vs Unconfirmed
            const pointStatus = this.getPropertyValue(task, 'Point Status', 'POINT STATUS', 'point status');

            // Task points - try multiple property names
            const pointVal = parseFloat(this.getPropertyValue(task, 'TP thực tế', 'TP THỰC TẾ', 'Task Point', 'TASK POINT') || 0);
            // Effort - try multiple property names  
            const effortVal = parseFloat(this.getPropertyValue(task, 'NLTT', 'nltt', 'Actual Effort', 'actual effort') || 0);

            if (String(pointStatus).toLowerCase() === 'confirmed') {
                effortConf += effortVal;
                pointConf += pointVal;
            } else {
                // All other statuses (including Unconfirmed, empty, etc.) go to Unconfirmed bucket
                effortUnconf += effortVal;
                pointUnconf += pointVal;
            }
        }

        const effortTotal = effortConf + effortUnconf; // C9
        const pointTotal = pointConf + pointUnconf;    // C12

        // Ratios - Productivity = Point / Effort
        const productivityConf = effortConf ? (pointConf / effortConf) : 0; // C13 (N)
        const productivityUnconf = effortUnconf ? (pointUnconf / effortUnconf) : 0; // C14 (O)
        const productivityTotal = effortTotal ? (pointTotal / effortTotal) : 0; // C15 (P)

        // Q: Completion Productivity Confirmed = Actual Productivity / Required Productivity (KPI)
        // Formula: (pointConf / effortConf) / KPI = productivityConf / KPI
        const completionProdConf = kpi ? (productivityConf / kpi) : null; // C16 (Q)

        // R: Completion Productivity Total = Total Productivity / Required Productivity (KPI)
        // Formula: (pointTotal / effortTotal) / KPI = productivityTotal / KPI
        const completionProdTotal = kpi ? (productivityTotal / kpi) : null; // C17 (R)

        // S: Completion Task Point Confirmed = Point Confirmed / Point Required
        const completionPointConf = pointReq ? (pointConf / pointReq) : null; // C18 (S)

        // T: Completion Task Point Total = Point Total / Point Required  
        const completionPointTotal = pointReq ? (pointTotal / pointReq) : null; // C19 (T)

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

        // Find date column - prioritize NGÀY LÀM
        // If NGÀY LÀM column exists, we use it (even if empty), we DO NOT fallback to DoneDate
        // This ensures strict filtering as requested.
        let dateValue = null;

        // 1. Try NGÀY LÀM first
        const ngayLamKeys = ['NGÀY LÀM', 'Ngày làm', 'Ngay lam', 'ngày làm'];
        const foundNgayLamKey = ngayLamKeys.find(k => props.hasOwnProperty(k));

        if (foundNgayLamKey) {
            // Column exists - take its value (valid or empty)
            dateValue = props[foundNgayLamKey];
        } else {
            // 2. Fallback to DoneDate/Work Date only if NGÀY LÀM column is missing entirely
            const doneDateKeys = ['DoneDate', 'Done Date', 'DONE DATE', 'Work Date', 'Date', 'Ngày', 'Time', 'Created time', 'Thời gian tạo'];
            for (const key of doneDateKeys) {
                if (props.hasOwnProperty(key)) {
                    dateValue = props[key];
                    break;
                }
            }
        }

        // 3. Last Resort: Use System Created Time (Stable) or Last Edited Time
        // Prioritize Created Time to avoid bulk-edit false positives in "This Month"
        if (!dateValue && (task.created_time || task.last_edited_time)) {
            return new Date(task.created_time || task.last_edited_time);
        }

        // Check if value is truly empty/invalid
        if (dateValue === null || dateValue === undefined || dateValue === '') return null;
        if (Array.isArray(dateValue) && dateValue.length === 0) return null;

        // NEW: Unpack Formula/Rollup/RichText objects to get the inner string/date
        if (typeof dateValue === 'object') {
            if (dateValue.type === 'formula') {
                const f = dateValue.formula;
                dateValue = f.string || f.date || f.number || null;
            } else if (dateValue.type === 'rollup') {
                // Rollup array logic - take last value? or first?
                // Usually date rollups are arrays. Take max?
                // For now, simplify: if array, take last.
                if (Array.isArray(dateValue.rollup?.array)) {
                    const arr = dateValue.rollup.array;
                    // Recursive extract if needed, but assuming primitive or date obj
                    const last = arr[arr.length - 1];
                    dateValue = last?.start || last?.formula?.string || last;
                }
            } else if (dateValue.type === 'rich_text' || dateValue.type === 'title') {
                dateValue = dateValue[0]?.plain_text || null;
            }
        }
        // Re-check emptiness after unpacking
        if (!dateValue) return null;


        // Handle object format: {start: "2025-01-15", end: "2025-01-20"}
        // Use END date as completion date, fallback to start
        if (typeof dateValue === 'object') {
            // Check for start/end keys (Notion Date Object)
            if (dateValue.start) {
                const dateStr = dateValue.end || dateValue.start;
                return new Date(dateStr);
            }
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

        // Handle Range string "Date1 -> Date2" (common in Notion formula output)
        if (rawDate.includes('->')) {
            const parts = rawDate.split('->');
            // Use End Date (last part)
            rawDate = parts[parts.length - 1].trim();
        }

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

        // Handle "January 5, 2026" (Month DD, YYYY)
        // JS Date constructor handles this well, but let's be explicit if needed.
        // new Date("January 5, 2026") works.

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
        // Add Vietnamese support 'Người thực hiện', 'Nhân sự'
        const props = task.properties || {};
        const keys = ['Assignee', 'Owner', 'assignee', 'owner', 'Người thực hiện', 'Người xử lý', 'Nhân sự', 'Person'];

        let assignees = null;
        for (const key of keys) {
            if (props[key]) {
                assignees = props[key];
                break;
            }
        }

        if (!assignees) return [];

        // Data is already transformed to array of {id, name, email}
        if (Array.isArray(assignees)) {
            return assignees.map(p => {
                const rawName = (p.name || '').trim();
                if (!rawName) return '';

                // Resolve alias: Notion short name → full name
                const fullAlias = NAME_ALIAS_MAPPING[rawName];
                if (fullAlias) return fullAlias;

                // Fuzzy match against SENIORITY_MAPPING keys (Canonical Names)
                // e.g. "Nguyễn Thị Hòa (Deedee)" -> "Nguyễn Thị Hòa"
                // e.g. "Nguyễn Thị Hòa" -> "Nguyễn Thị Hòa"
                // Fuzzy match against SENIORITY_MAPPING keys (Canonical Names)
                // e.g. "Nguyễn Thị Hòa (Deedee)" -> "Nguyễn Thị Hòa"
                // e.g. "Nguyễn Thị Hòa" -> "Nguyễn Thị Hòa"
                const knownNames = Object.keys(SENIORITY_MAPPING);
                const normalizedRaw = this.removeAccents(rawName.toLowerCase());

                const matchedName = knownNames.find(known => {
                    const normalizedKnown = this.removeAccents(known.toLowerCase());
                    // Check if raw name contains the known full name (e.g. "Nguyen Thi Hoa (Team Lead)" contains "Nguyen Thi Hoa")
                    // Or if known full name contains raw name (careful with short names, but useful for clean data)
                    return normalizedRaw.includes(normalizedKnown);
                });

                return matchedName || rawName;
            }).filter(n => n);
        }
        return [];
    }

    removeAccents(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
