import { ZigbeeDatabase } from './database.js';
import { MqttListener, MqttConfig } from './mqtt-listener.js';
import { ZigbeeMcpServer } from './mcp-server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import cors from 'cors';
import { logger } from './logger.js';

// Load environment variables
const config: MqttConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  baseTopic: process.env.MQTT_BASE_TOPIC || 'zigbee2mqtt',
};

const dbPath = process.env.DB_PATH || './zigbee2mqtt.db';
const transportMode = process.env.TRANSPORT_MODE || 'stdio'; // 'stdio' or 'http'
const httpPort = parseInt(process.env.HTTP_PORT || '3235');
const apiKey = process.env.API_KEY || undefined;

async function startStdioMode(db: ZigbeeDatabase, mqtt: MqttListener) {
  logger.debug('Starting in STDIO mode...');
  const mcpServer = new ZigbeeMcpServer(db, mqtt, config.baseTopic);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logger.info('MCP Server ready');
}

async function startHttpMode(db: ZigbeeDatabase, mqtt: MqttListener) {
  logger.debug(`Starting in HTTP/SSE mode on port ${httpPort}...`);

  const app = express();
  app.use(cors());
  app.use(express.json());

  const mcpServer = new ZigbeeMcpServer(db, mqtt, config.baseTopic);

  // Active SSE transports keyed by sessionId. We need to look up the
  // right transport when POST /messages comes in for an existing session.
  const transports = new Map<string, SSEServerTransport>();

  // Health check endpoint
  app.get('/health', (req, res) => {
    const stats = db.getStats();
    res.json({
      status: 'ok',
      mqtt_connected: mqtt.isConnected(),
      ...stats,
    });
  });

  // MCP SSE endpoint
  app.get('/sse', async (req, res) => {
    // Optional API key authentication
    if (apiKey) {
      const providedKey = req.headers['authorization']?.replace('Bearer ', '');
      if (providedKey !== apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    logger.info('New SSE connection from:', req.ip);
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });
    await mcpServer.connect(transport);
  });

  // MCP message endpoint (for POST requests from SSE)
  app.post('/messages', async (req, res) => {
    // Optional API key authentication
    if (apiKey) {
      const providedKey = req.headers['authorization']?.replace('Bearer ', '');
      if (providedKey !== apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    // Dispatch the POST body to the matching SSE transport. The third
    // argument tells the SDK to use the already-parsed body instead of
    // re-reading the request stream, which has already been consumed by
    // express.json() above.
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: 'No transport found for sessionId' });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  await new Promise<void>((resolve) => {
    app.listen(httpPort, () => {
      logger.startup(`✓ HTTP Server listening on port ${httpPort}`);
      logger.info(`  - Health: http://localhost:${httpPort}/health`);
      logger.info(`  - MCP SSE: http://localhost:${httpPort}/sse`);
      if (apiKey) {
        logger.info(`  - API Key authentication enabled`);
      }
      resolve();
    });
  });
}

async function main() {
  logger.startup('=== ZigBee2MQTT MCP Server ===');
  logger.debug(`Transport Mode: ${transportMode}`);
  logger.debug(`Database: ${dbPath}`);
  logger.debug(`MQTT Broker: ${config.brokerUrl}`);
  logger.debug(`Base Topic: ${config.baseTopic}`);

  // Initialize database
  const db = new ZigbeeDatabase(dbPath);
  logger.debug('Database initialized');

  // Initialize MQTT listener
  const mqtt = new MqttListener(config, db);

  try {
    // Connect to MQTT broker
    await mqtt.connect();
    logger.info('MQTT connected');

    // Wait a moment for initial retained messages to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Show initial stats
    const stats = db.getStats();
    logger.startup(`✓ Ready: ${stats.deviceCount} devices, ${stats.fieldCount} fields, ${stats.capabilityCount} capabilities`);

    // Start MCP server in selected mode
    if (transportMode === 'http') {
      await startHttpMode(db, mqtt);
    } else {
      await startStdioMode(db, mqtt);
    }

    // Keep the process running
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await mqtt.disconnect();
      db.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down...');
      await mqtt.disconnect();
      db.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Fatal error:', error);
    await mqtt.disconnect();
    db.close();
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
