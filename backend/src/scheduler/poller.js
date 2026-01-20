import cron from 'node-cron';
import { DataFetcher } from '../notion/fetcher.js';
import { DatabaseManager } from '../database/db.js';

/**
 * Polling Service
 * Periodically fetches data from Notion
 */
export class PollingService {
    constructor(db, wsServer, getAccessToken) {
        this.db = db;
        this.wsServer = wsServer;
        this.getAccessToken = getAccessToken; // Function to get current access token
        this.isRunning = false;
        this.cronJob = null;
    }

    /**
     * Start polling service
     * @param {number} intervalMs - Polling interval in milliseconds (default: 2 minutes)
     */
    start(intervalMs = 600000) { // Changed from 120000 (2min) to 600000 (10min)
        if (this.isRunning) {
            console.log('[Poller] Already running');
            return;
        }

        // Convert milliseconds to cron expression
        const intervalSeconds = Math.floor(intervalMs / 1000);
        let cronExpression;

        if (intervalSeconds >= 60) {
            const minutes = Math.floor(intervalSeconds / 60);
            cronExpression = `*/${minutes} * * * *`; // Every N minutes
        } else {
            cronExpression = `*/${intervalSeconds} * * * * *`; // Every N seconds
        }

        console.log(`[Poller] Starting with interval: ${intervalMs}ms (${cronExpression})`);

        // Run immediately on start
        this.poll();

        // Schedule periodic polling
        this.cronJob = cron.schedule(cronExpression, () => {
            this.poll();
        });

        this.isRunning = true;
        console.log('[Poller] ✅ Service started');
    }

    /**
     * Perform a single poll operation
     */
    async poll() {
        try {
            console.log('[Poller] Starting data fetch...');

            // Get access token (from session or other source)
            const accessToken = this.getAccessToken();

            if (!accessToken) {
                console.log('[Poller] No access token available, skipping poll');
                return;
            }

            // Get selected databases
            const selectedDatabases = this.db.getConfig('selected_databases');

            if (!selectedDatabases || selectedDatabases.length === 0) {
                console.log('[Poller] No databases selected, skipping poll');
                return;
            }

            // Fetch data
            const fetcher = new DataFetcher(accessToken);
            const data = await fetcher.fetchAllData(selectedDatabases);

            // Save to database
            for (const [dbId, records] of Object.entries(data)) {
                this.db.saveData(dbId, records);
            }

            const totalRecords = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
            console.log(`[Poller] ✅ Fetch completed: ${totalRecords} total records`);

            // Notify WebSocket clients
            if (this.wsServer) {
                this.wsServer.broadcastUpdate({
                    message: 'Data updated',
                    records_count: totalRecords,
                    databases_count: selectedDatabases.length
                });
            }
        } catch (error) {
            console.error('[Poller] ❌ Error during poll:', error);

            // Notify clients about error
            if (this.wsServer) {
                this.wsServer.broadcastUpdate({
                    type: 'error',
                    message: 'Failed to fetch data',
                    error: error.message
                });
            }
        }
    }

    /**
     * Stop polling service
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
        }

        this.isRunning = false;
        console.log('[Poller] Service stopped');
    }

    /**
     * Manually trigger a poll
     */
    async triggerPoll() {
        console.log('[Poller] Manual poll triggered');
        await this.poll();
    }
}
