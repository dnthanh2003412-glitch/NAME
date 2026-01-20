import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: join(__dirname, '../.env') });

import { setupRoutes } from './api/routes.js';
import { RealtimeServer } from './websocket/server.js';
import { PollingService } from './scheduler/poller.js';
import { DatabaseManager } from './database/db.js';

/**
 * Main Application Entry Point
 */
class NotionDashboardServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.db = new DatabaseManager();
        this.accessToken = null; // Will be set via session
    }

    /**
     * Initialize the server
     */
    async init() {
        console.log('🚀 Starting Notion Dashboard Server...');

        // Create HTTP server
        this.server = createServer(this.app);

        // Setup middleware FIRST
        this.app.use(cors({
            origin: true,
            credentials: true
        }));

        this.app.use(session({
            secret: process.env.SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: false,
                maxAge: 24 * 60 * 60 * 1000
            }
        }));

        this.app.use(express.json());

        // Setup API routes
        setupRoutes(this.app, this.db);

        // Serve frontend static files LAST
        const frontendPath = join(__dirname, '..', '..', 'frontend', 'public');
        this.app.use(express.static(frontendPath));
        console.log('[Server] Serving frontend from:', frontendPath);

        // Setup WebSocket server
        this.wsServer = new RealtimeServer(this.server);

        // Setup polling service
        const pollingInterval = parseInt(process.env.POLLING_INTERVAL) || 120000;
        this.poller = new PollingService(
            this.db,
            this.wsServer,
            () => this.getAccessToken()
        );

        // Start polling immediately
        this.poller.start(pollingInterval);

        // Graceful shutdown handling
        this.setupShutdownHandlers();

        // Start server
        this.server.listen(this.port, () => {
            console.log('');
            console.log('✅ Notion Dashboard đang chạy!');
            console.log(`📡 Backend API: http://localhost:${this.port}`);
            console.log(`🎨 Frontend: http://localhost:${this.port}`);
            console.log(`🔌 WebSocket: ws://localhost:${this.port}`);
            console.log(`🔄 Polling: ${pollingInterval}ms`);
            console.log('');
            console.log('📋 Các bước tiếp theo:');
            console.log(`1. Mở trình duyệt: http://localhost:${this.port}`);
            console.log('2. Click "Connect Notion" để đăng nhập');
            console.log('3. Chọn databases và xem báo cáo');
            console.log('');
        });
    }

    /**
     * Get current access token from session store
     * Note: In a real implementation, you'd need a proper session store
     * This is a simplified version
     */
    getAccessToken() {
        // For now, get from config (will be saved after OAuth)
        return this.db.getConfig('access_token');
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupShutdownHandlers() {
        const shutdown = () => {
            console.log('\\n🛑 Shutting down gracefully...');

            // Stop polling
            if (this.poller) {
                this.poller.stop();
            }

            // Close WebSocket server
            if (this.wsServer) {
                this.wsServer.close();
            }

            // Close database
            if (this.db) {
                this.db.close();
            }

            // Close HTTP server
            if (this.server) {
                this.server.close(() => {
                    console.log('✅ Server closed');
                    process.exit(0);
                });
            }
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}

// Start the server
const server = new NotionDashboardServer();
server.init().catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});
