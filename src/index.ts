import express, { Request, Response, NextFunction } from 'express';
import { env } from './config/env.js';
import logger from './lib/logger.js';
import { requestLogging, errorLogging } from './middleware/logging.js';
import webhooksRouter from './routes/webhooks.js';
import { checkSupabaseConnection } from './lib/supabase.js';
import { startReminderCron } from './lib/reminder-service.js';
import { startFollowUpCron } from './lib/follow-up-service.js';
import { startAutoFillCron } from './lib/auto-fill-service.js';

const app = express();

// Request logging middleware (before body parsing)
app.use(requestLogging);

// Webhook routes need raw body for signature verification
// Must be before the general JSON parser to capture raw body
app.use('/webhook', express.raw({ type: 'application/json', limit: '100kb' }), webhooksRouter);

// General body parsing for non-webhook routes
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Hello World API endpoint
app.get('/api/hello', (_req: Request, res: Response) => {
  res.status(200).json({
    message: 'Hello World',
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn({ method: req.method, url: req.originalUrl }, 'Route not found');
  // req is used above for logging
  res.status(404).json({
    success: false,
    message: 'Not found',
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use(errorLogging);
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const isDevelopment = env.NODE_ENV === 'development';

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(isDevelopment && { error: err.message }),
    timestamp: new Date().toISOString(),
  });
});

async function startServer(): Promise<void> {
  try {
    // Check Supabase connectivity before starting
    const isConnected = await checkSupabaseConnection();
    if (!isConnected) {
      logger.error('Failed to connect to Supabase. Exiting.');
      process.exit(1);
    }

    app.listen(env.PORT, () => {
      logger.info({
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
      }, 'Server started successfully');

      // Start the cron jobs for appointment reminders, follow-ups, and auto-fill
      startReminderCron();
      startFollowUpCron();
      startAutoFillCron();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: message }, 'Failed to start server');
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error({ error: err.message, stack: err.stack }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
  process.exit(1);
});

startServer();

export default app;
