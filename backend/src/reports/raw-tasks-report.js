import { BaseReport } from './base-report.js';

/**
 * Raw Tasks Report
 * Returns all tasks with detailed information
 */
export class RawTasksReport extends BaseReport {
    constructor() {
        super('raw-tasks-report', 'Danh Sách Công Việc');
    }

    calculate(rawData) {
        const allRecords = Object.values(rawData).flat();

        return allRecords.map(record => ({
            id: record.id,
            created_time: record.created_time,
            last_edited_time: record.last_edited_time,
            properties: record.properties
        }));
    }

    format(calculatedData) {
        // Extract and flatten common properties for easier frontend display
        return calculatedData.map(record => {
            const props = record.properties;

            return {
                id: record.id,
                created_time: record.created_time,
                last_edited_time: record.last_edited_time,

                // Common fields (adjust names based on your database)
                name: props['Name'] || props['name'] || props['Tên task'] || '',
                status: props['Status'] || props['status'] || '',
                assignee: this.extractAssignee(props),
                sprint: props['Sprint'] || props['sprint'] || '',
                product: props['Product'] || props['product'] || props['Sản phẩm'] || '',
                task_point: props['Task point'] || props['task_point'] || props['Point'] || 0,
                actual_hours: props['Số công thực tế'] || props['actual_hours'] || 0,
                expected_hours: props['Số công yêu cầu'] || props['expected_hours'] || 0,
                done_qc: props['Done QC'] || props['done_qc'] || false,

                // Include all properties for flexibility
                all_properties: props
            };
        });
    }

    /**
     * Extract assignee name from various property formats
     */
    extractAssignee(props) {
        const assigneeField = props['Assignee'] ||
            props['assignee'] ||
            props['Người làm'] ||
            [];

        if (Array.isArray(assigneeField) && assigneeField.length > 0) {
            return assigneeField[0].name || 'Unassigned';
        }

        return 'Unassigned';
    }
}
