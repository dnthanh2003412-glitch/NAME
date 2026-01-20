import { SprintReport } from './src/reports/sprint-report.js';
import { ProductivityReport } from './src/reports/productivity-report.js';

// Mock Data
// We simulate data coming from Fetcher (transformed pages)
// Case 1: Product Definition (ID: prod-1 -> Name: Project Alpha)
// Case 2: Task linked to Product (Relation: [prod-1])
// Case 3: Task with String numbers ("5") to test type safety
const rawData = {
    'db-tasks': [
        {
            id: 'task-1',
            properties: {
                'Name': 'Task 1',
                'Task point': 5, // Number
                'Status': 'Done',
                'Sprint': 'Sprint 1',
                'Product': ['prod-1'], // Relation to Product
                'Assignee': [{ name: 'User A' }],
                'Số công thực tế': 2,
                'Số công yêu cầu': 4
            }
        },
        {
            id: 'task-2',
            properties: {
                'Name': 'Task 2 String Points',
                'Task point': "3", // String!
                'Status': 'Confirmed',
                'Sprint': 'Sprint 1',
                'Product': ['prod-1'],
                'Assignee': [{ name: 'User A' }],
                'Số công thực tế': "1.5", // String!
                'Số công yêu cầu': "2"
            }
        },
        {
            id: 'task-3',
            properties: {
                'Name': 'Task 3 Another Project',
                'Task point': 8,
                'Status': 'Pending',
                'Sprint': 'Sprint 2',
                'Product': ['prod-2'],
                'Assignee': [{ name: 'User B' }]
            }
        }
    ],
    'db-products': [
        {
            id: 'prod-1',
            properties: {
                'Name': 'Project Alpha' // This is the title logic
            }
        },
        {
            id: 'prod-2',
            properties: {
                'Name': 'Project Beta'
            }
        }
    ]
};

async function testReports() {
    console.log('--- Testing Sprint Report ---');
    try {
        const sprintReport = new SprintReport();
        const calc = sprintReport.calculate(rawData);
        const fmt = sprintReport.format(calc);
        console.log('Sprint Report Result:', JSON.stringify(fmt, null, 2));
    } catch (e) {
        console.error('Sprint Report Failed:', e);
    }

    console.log('\n--- Testing Productivity Report ---');
    try {
        const prodReport = new ProductivityReport();
        const calc = prodReport.calculate(rawData);
        const fmt = prodReport.format(calc);
        console.log('Productivity Report Result:', JSON.stringify(fmt, null, 2));
    } catch (e) {
        console.error('Productivity Report Failed:', e);
    }
}

testReports();
