import { ZigbeeDatabase } from './database.js';
import { MqttListener, MqttConfig } from './mqtt-listener.js';
import { ZigbeeMcpServer } from './mcp-server.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { logger } from './logger.js';

/* ================================
 * Config（只保留最基础）
 * ================================ */

const config: MqttConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  baseTopic: process.env.MQTT_BASE_TOPIC || 'zigbee2mqtt',
};

const dbPath = process.env.DB_PATH || './zigbee2mqtt.db';
const httpPort = Number(process.env.HTTP_PORT || 3235);
const httpHost = process.env.HTTP_HOST || '0.0.0.0';
const apiKey = process.env.API_KEY || undefined;
const mcpProtocolVersion = process.env.MCP_PROTOCOL_VERSION || '2025-06-18';

/* ================================
 * Helpers
 * ================================ */

function authOk(req: Request): boolean {
  if (!apiKey) return true;
  const provided = (req.headers['authorization'] as string | undefined)?.replace('Bearer ', '');
  return provided === apiKey;
}

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: any;
};

function jsonRpcResult(id: JsonRpcId, result: any) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/* ================================
 * HTTP MCP Server（始终启动）
 * ================================ */

async function startHttpServer(db: ZigbeeDatabase, mqtt: MqttListener) {
  logger.info(`Starting HTTP MCP server on ${httpHost}:${httpPort}`);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const mcpServer = new ZigbeeMcpServer(db, mqtt, config.baseTopic);

  // health
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mqtt_connected: mqtt.isConnected(),
      ...db.getStats(),
    });
  });

  // legacy SSE
  app.get('/sse', async (req, res) => {
    if (!authOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const transport = new SSEServerTransport('/messages', res);
    await mcpServer.connect(transport);
  });

  app.post('/messages', (_req, res) => {
    res.status(200).end();
  });

  // MCP probe
  app.get('/mcp', (_req, res) => {
    res.json({ status: 'ok', endpoint: '/mcp' });
  });

  // Streamable HTTP MCP
  app.post('/mcp', async (req: Request, res: Response) => {
    if (!authOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const msg = req.body as Partial<JsonRpcRequest>;
    const id: JsonRpcId = msg.id ?? null;

    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      res.status(400).json(jsonRpcError(id, -32600, 'Invalid Request'));
      return;
    }

    try {
      if (msg.method === 'initialize') {
        const result = {
          protocolVersion: mcpProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'zigbee2mqtt-mcp', version: '1.0.0' },
        };
        if (msg.id == null) res.status(204).end();
        else res.json(jsonRpcResult(id, result));
        return;
      }


      if (msg.method === 'notifications/initialized') {
        res.status(204).end();
        return;
      }

      if (msg.method === 'ping') {
        if (msg.id == null) res.status(204).end();
        else res.json(jsonRpcResult(id, { status: 'ok' }));
        return;
      }

      if (msg.method === 'tools/list') {
        const tools = (mcpServer as any).getToolDefinitions();
        if (msg.id == null) res.status(204).end();
        else res.json(jsonRpcResult(id, { tools }));
        return;
      }

      if (msg.method === 'tools/call') {
        const toolName = msg.params?.name;
        const toolArgs = msg.params?.arguments ?? {};
        const result = await (mcpServer as any).callToolByName(toolName, toolArgs);
        if (msg.id == null) res.status(204).end();
        else res.json(jsonRpcResult(id, result));
        return;
      }

      res.status(404).json(jsonRpcError(id, -32601, 'Method not found'));
    } catch (e: any) {
      res.status(500).json(jsonRpcError(id, -32603, e?.message || 'Internal error'));
    }
  });

  app.listen(httpPort, httpHost, () => {
    logger.info(`✓ HTTP MCP listening on ${httpHost}:${httpPort}`);
  });
}

/* ================================
 * Main
 * ================================ */

async function main() {
  logger.startup('=== ZigBee2MQTT MCP Server ===');

  const db = new ZigbeeDatabase(dbPath);
  const mqtt = new MqttListener(config, db);

  try {
    await mqtt.connect();
    await new Promise((r) => setTimeout(r, 2000));
    await startHttpServer(db, mqtt);
  } catch (err) {
    logger.error('Fatal error', err);
    process.exit(1);
  }
}

main();