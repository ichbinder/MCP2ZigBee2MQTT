# ZigBee2MQTT MCP Server

A Model Context Protocol (MCP) server for ZigBee2MQTT that provides intelligent device discovery and control for AI assistants.

> 🌐 **Remote-Capable!** This MCP server can run on a **remote server** (e.g., where your MQTT broker runs) and you can access it from your Mac via HTTP. See **[REMOTE-SETUP.md](REMOTE-SETUP.md)** for details!

## Deployment Options

- **Local (stdio)**: Container runs on your Mac, accessed via stdio
- **Remote (HTTP/SSE)**: Container runs on server, accessed via HTTP → **[REMOTE-SETUP.md](REMOTE-SETUP.md)**

## Overview

This MCP server connects to your MQTT broker and automatically analyzes all ZigBee devices connected via ZigBee2MQTT. It learns the structure and capabilities of each device and makes this information available to AI assistants through MCP tools.

### Core Features

- **🔍 Intelligent Schema Discovery**: Automatically learns the structure and capabilities of your devices
- **💾 Compact Data Storage**: Stores only metadata and schemas, not complete message history
- **📚 Zigbee2MQTT Documentation**: Direct access to official device documentation
- **🐳 Docker-Ready**: Easy deployment with Docker Compose
- **🌐 Remote-Capable**: Runs on server, access via HTTP/SSE from anywhere
- **🔒 Security**: Optional API key authentication
- **🔌 Retained Messages**: Uses MQTT retained messages for instant access to device information
- **🏠 Home Automation**: Perfect for n8n, Home Assistant and other automation tools

### What is Stored?

✅ **Device Metadata** (Name, model, manufacturer)
✅ **Field Schemas** (Which fields does a device have? What data types?)
✅ **Capabilities** (Can dim, change color, measure temperature, etc.)
✅ **Current State** (Only last value, no history)

❌ **Not Stored**: Complete message history, time-based sensor data

**Estimated Database Size**: ~1-2 MB for 100 devices (instead of GB with full history!)

## Prerequisites

- Node.js 20+ or Docker
- Running ZigBee2MQTT installation
- MQTT Broker (e.g., Mosquitto)

## Installation

### Option 1: Docker (Recommended)

1. **Clone repository**
   ```bash
   git clone <repository-url>
   cd zigbeeMCP
   ```

2. **Create environment file**
   ```bash
   cp .env.example .env
   ```

3. **Configure .env**
   ```env
   MQTT_BROKER_URL=mqtt://192.168.1.100:1883
   MQTT_USERNAME=your_user
   MQTT_PASSWORD=your_password
   MQTT_BASE_TOPIC=zigbee2mqtt
   DB_PATH=/data/zigbee2mqtt.db

   # Log Level: debug, info, warn, error, silent
   # Recommended: error (minimal output)
   LOG_LEVEL=error
   ```

   `MQTT_BROKER_URL` supports TCP (`mqtt://` and `mqtts://`) and MQTT over WebSockets (`ws://` and `wss://`). WebSocket connections require an MQTT-over-WebSocket listener on the broker; include its broker-specific path (often `/mqtt`) in the URL when required.

   ```env
   # Unencrypted MQTT over WebSocket
   MQTT_BROKER_URL=ws://broker.example.com:9001/mqtt

   # MQTT over secure WebSocket
   MQTT_BROKER_URL=wss://broker.example.com/mqtt
   ```

   `MQTT_USERNAME`, `MQTT_PASSWORD`, and `MQTT_BASE_TOPIC` are used unchanged with every scheme.

   For `wss://`, the current implementation keeps Node.js default TLS verification enabled (`rejectUnauthorized: true`): both the certificate chain and hostname are checked against the Node.js trust store. A certificate issued by a private CA is rejected until that CA is trusted.

   To trust a private CA, extend the Node.js trust store before the process starts with [`NODE_EXTRA_CA_CERTS`](https://nodejs.org/docs/latest-v20.x/api/cli.html#node_extra_ca_certsfile), pointing to a PEM file. Node.js reads this variable only at process startup. With Docker, mount the PEM file and pass the variable to the container, for example:

   ```yaml
   # docker-compose.override.yml
   services:
     zigbee2mqtt-mcp:
       environment:
         NODE_EXTRA_CA_CERTS: /certs/mqtt-ca.pem
       volumes:
         - ./certs/mqtt-ca.pem:/certs/mqtt-ca.pem:ro
   ```

   The server does not currently expose per-connection `ca` or `rejectUnauthorized` settings. Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0`; it disables TLS certificate verification for the whole Node.js process.

4. **Start container**
   ```bash
   docker compose up -d
   ```

5. **View logs**
   ```bash
   docker compose logs -f
   ```

### Option 2: Local Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Compile TypeScript**
   ```bash
   npm run build
   ```

3. **Start**
   ```bash
   npm start
   ```

## MCP Configuration

### Claude Desktop

Add the following to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "zigbee2mqtt": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "zigbee2mqtt-mcp",
        "node",
        "dist/index.js"
      ]
    }
  }
}
```

Or for local installation:

```json
{
  "mcpServers": {
    "zigbee2mqtt": {
      "command": "node",
      "args": ["/path/to/zigbeeMCP/dist/index.js"],
      "env": {
        "MQTT_BROKER_URL": "mqtt://localhost:1883",
        "MQTT_BASE_TOPIC": "zigbee2mqtt",
        "DB_PATH": "/path/to/zigbee2mqtt.db"
      }
    }
  }
}
```

## Available Tools

The MCP server provides the following tools:

### 1. `list_devices`
Lists all ZigBee devices.

**Example:**
```
Show me all my ZigBee devices
```

### 2. `get_device_info`
Shows detailed information about a specific device.

**Parameters:**
- `device`: Device friendly name or IEEE address

**Example:**
```
Show me details for the living room lamp
```

### 3. `find_devices`
Searches for devices by name, model, or description.

**Parameters:**
- `query`: Search term

**Example:**
```
Find all lamps in the living room
```

### 4. `get_device_state`
Shows the current state of a device.

**Parameters:**
- `device`: Device friendly name or IEEE address

**Example:**
```
Is the living room lamp on?
```

### 5. `send_command`
Sends a command to a device.

**Parameters:**
- `device`: Device friendly name or IEEE address
- `command`: Command as JSON object

**Example:**
```
Turn on the living room lamp
Set brightness to 50%
```

### 6. `find_by_capability`
Finds all devices with a specific capability.

**Parameters:**
- `capability`: Capability type (e.g., `on_off`, `brightness`, `temperature_sensor`)

**Example:**
```
Show all dimmable devices
Which devices can measure temperature?
```

**Common Capabilities:**
- `on_off` - Can be turned on/off
- `brightness` - Dimmable
- `color_temperature` - Color temperature adjustable
- `color` - Color changeable
- `temperature_sensor` - Temperature sensor
- `humidity_sensor` - Humidity sensor
- `contact_sensor` - Contact sensor
- `occupancy_sensor` - Motion sensor

### 7. `get_integration_info`
Provides integration information for n8n or other tools.

**Parameters:**
- `device`: Device friendly name or IEEE address

**Example:**
```
How can I integrate the living room lamp into n8n?
```

### 8. `get_stats`
Shows statistics about the ZigBee network.

**Example:**
```
How many devices are connected?
```

### 9. `get_device_documentation`
Provides links to official Zigbee2MQTT documentation for a specific device.

**Parameters:**
- `device`: Device friendly name or IEEE address

**Example:**
```
Show me the documentation for my Philips Hue lamp
How can I best control the "living_room_lamp" device?
What can my IKEA TRADFRI switch do?
```

**Returns:**
- Link to device documentation on zigbee2mqtt.io
- Model and vendor information
- Known capabilities of the device
- Direct link to search for the specific model

### 10. `get_recent_devices`
Lists devices that were added to the ZigBee network within the last N days.

**Parameters:**
- `days`: Number of days to look back (default: 7)

**Example:**
```
Which devices were added in the last week?
Show me all new devices since yesterday
Which devices have I paired in the last 30 days?
```

**Returns:**
- Number of days
- Number of devices found
- List of devices with:
  - Name, model, manufacturer
  - `created_at`: Timestamp when device was added
  - `last_seen`: Timestamp of last message
  - `updated_at`: Last update

**Note:** All timestamps are Unix timestamps (milliseconds since 1970-01-01).

## Usage Examples

### With Claude Desktop

```
User: "Is there a lamp in the living room?"
Claude: [Uses find_devices with query="living room"]
→ "Yes, I found 'living_room_ceiling_lamp' (Philips Hue White)"

User: "Turn it on"
Claude: [Uses send_command with {"state": "ON"}]
→ "The lamp has been turned on"

User: "How can I use this lamp in n8n?"
Claude: [Uses get_integration_info]
→ "You can use these MQTT topics:
   - Read: zigbee2mqtt/living_room_ceiling_lamp
   - Write: zigbee2mqtt/living_room_ceiling_lamp/set
   Example payload: {"state": "ON", "brightness": 200}"

User: "What can my IKEA TRADFRI switch do?"
Claude: [Uses get_device_documentation]
→ "Your IKEA TRADFRI switch (Model: E1743) supports:
   - Capabilities: button, battery
   - Documentation: https://www.zigbee2mqtt.io/supported-devices/#s=E1743
   - There you'll find all button events and MQTT payloads!"

User: "Which devices did I add in the last week?"
Claude: [Uses get_recent_devices with days=7]
→ "3 devices were added in the last 7 days:
   1. living_room_outlet (OSRAM Smart+ Plug) - 2 days ago
   2. bathroom_sensor (Aqara Temperature Sensor) - 5 days ago
   3. hallway_lamp (Philips Hue) - 6 days ago"
```

## Architecture

```
┌─────────────────────┐
│   AI Assistant      │
│   (Claude Desktop)  │
└──────────┬──────────┘
           │ MCP Protocol (stdio)
┌──────────▼──────────┐
│   MCP Server        │
│   - Tools Handler   │
│   - Response Gen.   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐      ┌──────────────────┐
│  SQLite Database    │      │  MQTT Listener   │
│  - Devices          │      │  - Subscribe All │
│  - Fields           │◄─────┤  - Process Msgs  │
│  - Capabilities     │      │  - Discovery     │
│  - Current State    │      └────────┬─────────┘
└─────────────────────┘               │
                                      │
                              ┌───────▼────────┐
                              │  MQTT Broker   │
                              │  (Mosquitto)   │
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │  ZigBee2MQTT   │
                              │  - ZigBee Net  │
                              │  - Devices     │
                              └────────────────┘
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs

# Rebuild container
docker compose down
docker compose build --no-cache
docker compose up -d
```

### MQTT connection fails

1. Check the broker URL, protocol, and port in `.env`
2. If the broker runs on the host, use `mqtt://host.docker.internal:1883`
3. For `ws://` or `wss://`, verify that the broker exposes an MQTT-over-WebSocket listener and that the URL includes its required path
4. For `wss://`, remember that Node.js verifies both the certificate chain and hostname by default
5. For a private CA, mount its PEM file, set `NODE_EXTRA_CA_CERTS` before Node.js starts, and restart the process or container
6. Check firewall rules and MQTT credentials

### No devices found

1. Check if ZigBee2MQTT is running: `zigbee2mqtt/bridge/state` should be "online"
2. Check base topic in `.env` - must match ZigBee2MQTT config
3. Check MQTT permissions

### Database errors

```bash
# Reset database
docker compose down
rm -rf data/
docker compose up -d
```

### Too many logs in Claude Desktop

The MCP server uses a configurable logging system:

**Adjust in `.env`:**
```env
# Minimal output (recommended)
LOG_LEVEL=error

# For debugging
LOG_LEVEL=debug
```

**Log Levels:**
- `silent` - No output
- `error` - Only errors (recommended for Claude Desktop)
- `warn` - Warnings + errors
- `info` - Normal output
- `debug` - All details

**After changes:**
```bash
docker compose restart
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# TypeScript in watch mode
npm run watch

# In another terminal: start server
npm run dev
```

### Project Structure

```
src/
├── index.ts              # Main entry point
├── types.ts              # TypeScript definitions
├── database.ts           # SQLite database logic
├── mqtt-listener.ts      # MQTT client & message handler
├── schema-discovery.ts   # Schema discovery engine
└── mcp-server.ts         # MCP server & tools
```

## License

MIT

## Support

For questions or issues, please create an issue on GitHub.
