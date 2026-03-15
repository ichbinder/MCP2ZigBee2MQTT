import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ZigbeeDatabase } from './database.js';
import { MqttListener } from './mqtt-listener.js';
import { DeviceInfo, DeviceFieldInfo, IntegrationInfo } from './types.js';
import { LOGICAL_DEVICES } from './logical-devices.js';


export class ZigbeeMcpServer {
  private server: Server;
  private db: ZigbeeDatabase;
  private mqtt: MqttListener;
  private baseTopic: string;

  constructor(db: ZigbeeDatabase, mqtt: MqttListener, baseTopic: string) {
    this.db = db;
    this.mqtt = mqtt;
    this.baseTopic = baseTopic;

    this.server = new Server(
      {
        name: 'zigbee2mqtt-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  getServer(): Server {
    return this.server;
  }

// ✅ 给 Streamable HTTP (/mcp) 用的：列出工具
  public getToolDefinitions() {
    // 直接复用你原来给 tools/list 用的定义
    return this.getTools();
  }

  // ✅ 给 Streamable HTTP (/mcp) 用的：按名字调用工具
  public async callToolByName(name: string, args: any) {
    try {
      switch (name) {
        case 'list_logical_devices':
          return await this.handleListLogicalDevices();
        case 'list_devices':
          return await this.handleListDevices(args);
        case 'get_device_info':
          return await this.handleGetDeviceInfo(args);
        case 'find_devices':
          return await this.handleFindDevices(args);
        case 'get_device_state':
          return await this.handleGetDeviceState(args);
        case 'send_command':
          return await this.handleSendCommand(args);
        case 'find_by_capability':
          return await this.handleFindByCapability(args);
        case 'get_integration_info':
          return await this.handleGetIntegrationInfo(args);
        case 'get_stats':
          return await this.handleGetStats();
        case 'get_device_documentation':
          return await this.handleGetDeviceDocumentation(args);
        case 'get_recent_devices':
          return await this.handleGetRecentDevices(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }


  private async handleListLogicalDevices() {
    const list = Object.entries(LOGICAL_DEVICES).map(([name, m]) => {
        if (m.kind === 'switch') {
            return {
                name,
                kind: m.kind,
                physicalDevice: m.physicalDevice,
                stateKey: m.stateKey,
            };
        }

        // cover
        return {
            name,
            kind: m.kind,
            physicalDevice: m.physicalDevice,
            invert: m.invert ?? false,
        };
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }],
    };
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_devices':
            return await this.handleListDevices(args);
          case 'get_device_info':
            return await this.handleGetDeviceInfo(args);
          case 'find_devices':
            return await this.handleFindDevices(args);
          case 'get_device_state':
            return await this.handleGetDeviceState(args);
          case 'send_command':
            return await this.handleSendCommand(args);
          case 'find_by_capability':
            return await this.handleFindByCapability(args);
          case 'get_integration_info':
            return await this.handleGetIntegrationInfo(args);
          case 'get_stats':
            return await this.handleGetStats();
          case 'get_device_documentation':
            return await this.handleGetDeviceDocumentation(args);
          case 'get_recent_devices':
            return await this.handleGetRecentDevices(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'list_logical_devices',
        description: 'List logical devices (like 客厅灯/餐厅灯) and how they map to physical switches/endpoints.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_devices',
        description: 'List all ZigBee devices with basic information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_device_info',
        description: 'Get detailed information about a specific device, including all fields, capabilities, and current state',
        inputSchema: {
          type: 'object',
          properties: {
            device: {
              type: 'string',
              description: 'Device friendly name or IEEE address',
            },
          },
          required: ['device'],
        },
      },
      {
        name: 'find_devices',
        description: 'Search for devices by name, model, or description',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (searches in name, model, description)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_device_state',
        description: 'Get the current state of a device',
        inputSchema: {
          type: 'object',
          properties: {
            device: {
              type: 'string',
              description: 'Device friendly name or IEEE address',
            },
          },
          required: ['device'],
        },
      },
      {
        name: 'send_command',
        description: 'Send a command to control a device (e.g., turn on/off, set brightness)',
        inputSchema: {
          type: 'object',
          properties: {
            device: {
              type: 'string',
              description: 'Device friendly name or IEEE address',
            },
            command: {
              type: 'object',
              description: 'Command payload (e.g., {"state": "ON"}, {"brightness": 200})',
            },
          },
          required: ['device', 'command'],
        },
      },
      {
        name: 'find_by_capability',
        description: 'Find all devices with a specific capability (e.g., lights, temperature sensors)',
        inputSchema: {
          type: 'object',
          properties: {
            capability: {
              type: 'string',
              description: 'Capability type (e.g., on_off, brightness, temperature_sensor)',
            },
          },
          required: ['capability'],
        },
      },
      {
        name: 'get_integration_info',
        description: 'Get information for integrating a device with other systems like n8n (MQTT topics, commands, examples)',
        inputSchema: {
          type: 'object',
          properties: {
            device: {
              type: 'string',
              description: 'Device friendly name or IEEE address',
            },
          },
          required: ['device'],
        },
      },
      {
        name: 'get_stats',
        description: 'Get statistics about the ZigBee network (number of devices, fields, capabilities)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_device_documentation',
        description: 'Get link to official Zigbee2MQTT documentation for a specific device model. Useful for detailed device specifications, supported features, and troubleshooting.',
        inputSchema: {
          type: 'object',
          properties: {
            device: {
              type: 'string',
              description: 'Device friendly name or IEEE address',
            },
          },
          required: ['device'],
        },
      },
      {
        name: 'get_recent_devices',
        description: 'List devices that were added to the ZigBee network within the last N days. Useful for finding newly paired devices.',
        inputSchema: {
          type: 'object',
          properties: {
            days: {
              type: 'number',
              description: 'Number of days to look back (default: 7)',
            },
          },
        },
      },
    ];
  }

  private async handleListDevices(_args: any) {
    const devices = this.db.getAllDevices();

    const deviceList = devices.map(d => ({
      friendly_name: d.friendly_name,
      ieee_address: d.ieee_address,
      model: d.model || 'Unknown',
      vendor: d.vendor || 'Unknown',
      type: d.device_type || 'Unknown',
      created_at: d.created_at,
      last_seen: d.last_seen,
      updated_at: d.updated_at,
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(deviceList, null, 2),
        },
      ],
    };
  }

  private async handleGetDeviceInfo(args: any) {
    const { device } = args;
    const dbDevice = this.db.getDevice(device);

    if (!dbDevice) {
      throw new Error(`Device not found: ${device}`);
    }

    const fields = this.db.getDeviceFields(dbDevice.ieee_address);
    const capabilities = this.db.getDeviceCapabilities(dbDevice.ieee_address);
    const currentState = this.db.getDeviceState(dbDevice.ieee_address);

    const deviceInfo: DeviceInfo = {
      ieee_address: dbDevice.ieee_address,
      friendly_name: dbDevice.friendly_name,
      model: dbDevice.model,
      vendor: dbDevice.vendor,
      description: dbDevice.description,
      device_type: dbDevice.device_type,
      fields: fields.map(f => ({
        name: f.field_name,
        type: f.field_type,
        min: f.value_min,
        max: f.value_max,
        values: f.enum_values,
        unit: f.unit,
        description: f.description,
      })),
      capabilities: capabilities.map(c => c.capability_type),
      current_state: currentState || undefined,
      created_at: dbDevice.created_at,
      last_seen: dbDevice.last_seen,
      updated_at: dbDevice.updated_at,
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(deviceInfo, null, 2),
        },
      ],
    };
  }

  private async handleFindDevices(args: any) {
    const { query } = args;
    const devices = this.db.searchDevices(query);

    const deviceList = devices.map(d => ({
      friendly_name: d.friendly_name,
      ieee_address: d.ieee_address,
      model: d.model || 'Unknown',
      vendor: d.vendor || 'Unknown',
      description: d.description,
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(deviceList, null, 2),
        },
      ],
    };
  }

  private async handleGetDeviceState(args: any) {
    const { device } = args;
    const dbDevice = this.db.getDevice(device);

    if (!dbDevice) {
      throw new Error(`Device not found: ${device}`);
    }

    const state = this.db.getDeviceState(dbDevice.ieee_address);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(state || {}, null, 2),
        },
      ],
    };
  }

  private async handleSendCommand(args: any) {
    const { device, command } = args;

    // 1) 先尝试按“真实设备名/IEEE”找
    let dbDevice = this.db.getDevice(device);
    if (dbDevice) {
      await this.mqtt.publishCommand(dbDevice.friendly_name, command);
      return {
        content: [{ type: 'text' as const, text: `Command sent to ${dbDevice.friendly_name}: ${JSON.stringify(command)}` }],
      };
    }

    // 2) 找不到就按“逻辑设备名”映射
    const mapping = LOGICAL_DEVICES[device];
    if (!mapping) {
      throw new Error(`Device not found (neither physical nor logical): ${device}`);
    }

    dbDevice = this.db.getDevice(mapping.physicalDevice);
    if (!dbDevice) {
      throw new Error(`Physical device not found for logical device "${device}": ${mapping.physicalDevice}`);
    }

    // 3) switch：把 state 翻译到 state_left/state_right
    if (mapping.kind === 'switch') {
      const state = (command?.state ?? command?.State ?? '').toString().toUpperCase();
      if (!state) throw new Error(`Missing command.state for switch. Example: {"state":"ON"}`);
      const translated = { [mapping.stateKey]: state };
      await this.mqtt.publishCommand(dbDevice.friendly_name, translated);
      return {
        content: [{ type: 'text' as const, text: `Logical "${device}" -> ${dbDevice.friendly_name} payload ${JSON.stringify(translated)}` }],
      };
    }

    // 4) cover：支持 state OPEN/CLOSE/STOP 或 position 0..100
    if (mapping.kind === 'cover') {
      // 4.1 百分比优先
      if (command?.position !== undefined && command?.position !== null) {
        let pos = Number(command.position);
        if (Number.isNaN(pos)) throw new Error(`position must be a number 0..100`);
        if (pos < 0) pos = 0;
        if (pos > 100) pos = 100;

        // invert 支持：如果设备定义 open/close 方向反了，翻转百分比
        if (mapping.invert) pos = 100 - pos;

        // Zigbee2MQTT：position 0..100 发布到 <base>/<friendly>/set [1](https://www.zigbee2mqtt.io/devices/ZM-AM02_cover.html)[2](https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html)
        const translated = { position: pos };
        await this.mqtt.publishCommand(dbDevice.friendly_name, translated);

        return {
          content: [{ type: 'text' as const, text: `Logical "${device}" -> ${dbDevice.friendly_name} payload ${JSON.stringify(translated)}` }],
        };
      }

      // 4.2 开/关/停：state OPEN/CLOSE/STOP [1](https://www.zigbee2mqtt.io/devices/ZM-AM02_cover.html)
      const state = (command?.state ?? '').toString().toUpperCase();
      if (!state) {
        throw new Error(`Cover requires command.state (OPEN/CLOSE/STOP) or command.position (0..100).`);
      }
      const allowed = new Set(['OPEN', 'CLOSE', 'STOP']);
      if (!allowed.has(state)) {
        throw new Error(`Invalid cover state: ${state}. Use OPEN/CLOSE/STOP.`);
      }

      const translated = { state };
      await this.mqtt.publishCommand(dbDevice.friendly_name, translated);

      return {
        content: [{ type: 'text' as const, text: `Logical "${device}" -> ${dbDevice.friendly_name} payload ${JSON.stringify(translated)}` }],
      };
    }

    throw new Error(`Unsupported logical device mapping kind`);
  }

  private async handleFindByCapability(args: any) {
    const { capability } = args;
    const devices = this.db.findDevicesByCapability(capability);

    const deviceList = devices.map(d => ({
      friendly_name: d.friendly_name,
      ieee_address: d.ieee_address,
      model: d.model || 'Unknown',
      vendor: d.vendor || 'Unknown',
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(deviceList, null, 2),
        },
      ],
    };
  }

  private async handleGetIntegrationInfo(args: any) {
    const { device } = args;
    const dbDevice = this.db.getDevice(device);

    if (!dbDevice) {
      throw new Error(`Device not found: ${device}`);
    }

    const fields = this.db.getDeviceFields(dbDevice.ieee_address);
    const capabilities = this.db.getDeviceCapabilities(dbDevice.ieee_address);

    // Build example commands based on capabilities
    const exampleCommands: Record<string, any> = {};

    capabilities.forEach(cap => {
      if (cap.capability_type === 'on_off') {
        exampleCommands.turn_on = { state: 'ON' };
        exampleCommands.turn_off = { state: 'OFF' };
        exampleCommands.toggle = { state: 'TOGGLE' };
      }
      if (cap.capability_type === 'brightness') {
        exampleCommands.set_brightness = { brightness: 128 };
      }
      if (cap.capability_type === 'color_temperature') {
        exampleCommands.set_color_temp = { color_temp: 300 };
      }
    });

    const integrationInfo: IntegrationInfo = {
      device: dbDevice.friendly_name,
      mqtt_topic_get: `${this.baseTopic}/${dbDevice.friendly_name}`,
      mqtt_topic_set: `${this.baseTopic}/${dbDevice.friendly_name}/set`,
      available_commands: exampleCommands,
      example_payloads: {
        read_state: `Subscribe to: ${this.baseTopic}/${dbDevice.friendly_name}`,
        set_commands: exampleCommands,
      },
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(integrationInfo, null, 2),
        },
      ],
    };
  }

  private async handleGetStats() {
    const stats = this.db.getStats();

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  private async handleGetDeviceDocumentation(args: any) {
    const { device } = args;
    const dbDevice = this.db.getDevice(device);

    if (!dbDevice) {
      throw new Error(`Device not found: ${device}`);
    }

    const model = dbDevice.model || 'Unknown';
    const vendor = dbDevice.vendor || 'Unknown';
    const capabilities = this.db.getDeviceCapabilities(dbDevice.ieee_address);
    const fields = this.db.getDeviceFields(dbDevice.ieee_address);

    // Construct Zigbee2MQTT documentation URLs
    const devicePageUrl = `https://www.zigbee2mqtt.io/devices/${model}.html`;
    const searchUrl = `https://www.zigbee2mqtt.io/supported-devices/#s=${encodeURIComponent(model)}`;

    // Try to fetch the actual device documentation page
    let fetchedInfo: any = null;
    try {
      const response = await fetch(devicePageUrl);
      if (response.ok) {
        const html = await response.text();
        fetchedInfo = this.parseDeviceDocumentation(html);
      }
    } catch (error) {
      // If fetch fails, continue with basic info
    }

    // Build documentation response
    const documentation = {
      device: dbDevice.friendly_name,
      model: model,
      vendor: vendor,
      documentation_url: devicePageUrl,
      search_url: searchUrl,
      device_info: {
        ieee_address: dbDevice.ieee_address,
        description: dbDevice.description || 'No description available',
        capabilities: capabilities.map(c => c.capability_type),
        fields: fields.map(f => ({
          name: f.field_name,
          type: f.field_type,
          unit: f.unit,
          values: f.enum_values
        })),
      },
      ...(fetchedInfo && {
        zigbee2mqtt_documentation: fetchedInfo,
      }),
      hint: `Full documentation available at: ${devicePageUrl}`,
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(documentation, null, 2),
        },
      ],
    };
  }

  private parseDeviceDocumentation(html: string): any {
    const info: any = {};

    // Helper function to extract text between headings
    const extractSection = (heading: string, maxLength?: number): string | null => {
      const regex = new RegExp(`<h2[^>]*>${heading}<\\/h2>([\\s\\S]*?)(?:<h2|<div class="footer"|$)`, 'i');
      const match = html.match(regex);
      if (match) {
        let text = match[1]
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();

        if (maxLength && text.length > maxLength) {
          text = text.substring(0, maxLength) + '...';
        }

        return text || null;
      }
      return null;
    };

    // Extract vendor and model from page title or meta
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) {
      info.page_title = titleMatch[1].replace(/\s+/g, ' ').trim();
    }

    // Description
    const description = extractSection('Description', 2000);
    if (description) {
      info.description = description;
    }

    // Picture/Image URL
    const imageMatch = html.match(/<img[^>]*src=["']([^"']*(?:jpg|jpeg|png|gif|webp))[^"']*["']/i);
    if (imageMatch) {
      info.image_url = imageMatch[1].startsWith('http')
        ? imageMatch[1]
        : `https://www.zigbee2mqtt.io${imageMatch[1]}`;
    }

    // OTA Support
    if (html.includes('Supports OTA updates') ||
        html.includes('>OTA<') ||
        html.includes('OTA updates supported')) {
      info.ota_supported = true;
    } else if (html.match(/<h2[^>]*>Exposes<\/h2>/i)) {
      info.ota_supported = false;
    }

    // Pairing instructions
    const pairing = extractSection('Pairing', 2000);
    if (pairing) {
      info.pairing_instructions = pairing;
    }

    // Notes
    const notes = extractSection('Notes', 3000);
    if (notes) {
      info.notes = notes;
    }

    // How to use
    const howToUse = extractSection('How to use', 2000);
    if (howToUse) {
      info.how_to_use = howToUse;
    }

    // Manual Home Assistant configuration
    const haConfig = extractSection('Manual Home Assistant configuration', 2000);
    if (haConfig) {
      info.home_assistant_config = haConfig;
    }

    // Exposes (features) - Extract detailed information
    const exposesMatch = html.match(/<h2[^>]*>Exposes<\/h2>([\s\S]*?)(?:<h2|<div class="footer"|$)/i);
    if (exposesMatch) {
      const exposesHtml = exposesMatch[1];
      const exposes: any[] = [];

      // Extract feature sections with h3 headings
      const featureMatches = exposesHtml.matchAll(/<h3[^>]*>(.*?)<\/h3>([\s\S]*?)(?=<h3|$)/gi);
      for (const match of featureMatches) {
        const featureName = match[1].replace(/<[^>]+>/g, '').trim();
        const featureContent = match[2];

        const feature: any = {
          name: featureName
        };

        // Extract feature description
        const descMatch = featureContent.match(/<p[^>]*>(.*?)<\/p>/i);
        if (descMatch) {
          feature.description = descMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        }

        // Extract properties from lists or tables
        const properties: string[] = [];
        const propMatches = featureContent.matchAll(/<li[^>]*>(.*?)<\/li>/gi);
        for (const propMatch of propMatches) {
          const prop = propMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (prop) {
            properties.push(prop);
          }
        }

        if (properties.length > 0) {
          feature.properties = properties;
        }

        // Extract code snippets (MQTT payloads, etc.)
        const codeMatches = featureContent.matchAll(/<code[^>]*>(.*?)<\/code>/gi);
        const codeSnippets: string[] = [];
        for (const codeMatch of codeMatches) {
          const code = codeMatch[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
          if (code && !codeSnippets.includes(code)) {
            codeSnippets.push(code);
          }
        }

        if (codeSnippets.length > 0) {
          feature.examples = codeSnippets;
        }

        exposes.push(feature);
      }

      if (exposes.length > 0) {
        info.exposes = exposes;
      }
    }

    // Extract any tables (specifications, etc.)
    const tableMatches = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);
    const tables: any[] = [];
    for (const tableMatch of tableMatches) {
      const tableHtml = tableMatch[0];
      const rows: any[] = [];

      const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      for (const rowMatch of rowMatches) {
        const cells: string[] = [];
        const cellMatches = rowMatch[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gi);
        for (const cellMatch of cellMatches) {
          cells.push(cellMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim());
        }
        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        tables.push(rows);
      }
    }

    if (tables.length > 0) {
      info.specifications = tables;
    }

    // Extract vendor info if present
    const vendorMatch = html.match(/Vendor[:\s]+([^<\n]+)/i);
    if (vendorMatch) {
      info.vendor_from_page = vendorMatch[1].trim();
    }

    // Extract model info if present
    const modelMatch = html.match(/Model[:\s]+([^<\n]+)/i);
    if (modelMatch) {
      info.model_from_page = modelMatch[1].trim();
    }

    // Extract support status
    if (html.includes('Not supported') || html.includes('not supported')) {
      info.support_status = 'not_supported';
    } else if (html.includes('supported')) {
      info.support_status = 'supported';
    }

    // Extract link to external resources (GitHub, vendor site, etc.)
    const links: string[] = [];
    const linkMatches = html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>/gi);
    for (const linkMatch of linkMatches) {
      const url = linkMatch[1];
      if (url.includes('github.com') ||
          url.includes('koenkk') ||
          (url.startsWith('http') && !url.includes('zigbee2mqtt.io'))) {
        if (!links.includes(url)) {
          links.push(url);
        }
      }
    }

    if (links.length > 0) {
      info.external_links = links.slice(0, 10); // Limit to 10 links
    }

    return Object.keys(info).length > 0 ? info : null;
  }

  private async handleGetRecentDevices(args: any) {
    const days = args.days || 7; // Default to 7 days
    const devices = this.db.getRecentDevices(days);

    const deviceList = devices.map(d => ({
      friendly_name: d.friendly_name,
      ieee_address: d.ieee_address,
      model: d.model || 'Unknown',
      vendor: d.vendor || 'Unknown',
      type: d.device_type || 'Unknown',
      created_at: d.created_at,
      last_seen: d.last_seen,
      updated_at: d.updated_at,
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            days_ago: days,
            device_count: deviceList.length,
            devices: deviceList,
          }, null, 2),
        },
      ],
    };
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }
}
