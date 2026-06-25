import mqtt from 'mqtt';
import { ZigbeeDatabase } from './database.js';
import { SchemaDiscovery } from './schema-discovery.js';
import { Z2MDevice } from './types.js';
import { logger } from './logger.js';

export interface MqttConfig {
  brokerUrl: string;
  username?: string;
  password?: string;
  baseTopic: string;
}

export class MqttListener {
  private client: mqtt.MqttClient | null = null;
  private db: ZigbeeDatabase;
  private discovery: SchemaDiscovery;
  private config: MqttConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(config: MqttConfig, db: ZigbeeDatabase) {
    this.config = config;
    this.db = db;
    this.discovery = new SchemaDiscovery(db);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.debug(`Connecting to MQTT broker: ${this.config.brokerUrl}`);

      const options: mqtt.IClientOptions = {
        username: this.config.username,
        password: this.config.password,
        reconnectPeriod: 5000,
        clean: false, // Use persistent session to get retained messages
        clientId: `zigbee2mqtt-mcp-${Date.now()}`,
      };

      this.client = mqtt.connect(this.config.brokerUrl, options);

      this.client.on('connect', () => {
        logger.debug('Connected to MQTT broker');
        this.reconnectAttempts = 0;
        this.subscribeToTopics();
        resolve();
      });

      this.client.on('error', (error) => {
        logger.error('MQTT Error:', error.message);
        if (this.reconnectAttempts === 0) {
          reject(error);
        }
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        logger.warn(`Reconnecting to MQTT (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          logger.error('Max reconnect attempts reached');
          this.client?.end();
        }
      });

      this.client.on('offline', () => {
        logger.warn('MQTT client offline');
      });

      this.client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload);
      });
    });
  }

  private subscribeToTopics(): void {
    if (!this.client) return;

    const baseTopic = this.config.baseTopic;

    // Subscribe to all topics to learn device structure
    const topics = [
      `${baseTopic}/bridge/devices`,      // Retained: All device definitions
      `${baseTopic}/bridge/state`,        // Retained: Bridge state
      `${baseTopic}/bridge/groups`,       // Retained: Groups
      `${baseTopic}/+`,                   // All device state updates
      `${baseTopic}/+/availability`,      // Device availability (retained)
    ];

    topics.forEach(topic => {
      this.client?.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          logger.error(`Failed to subscribe to ${topic}:`, err);
        } else {
          logger.debug(`Subscribed to ${topic}`);
        }
      });
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const message = payload.toString();
      const baseTopic = this.config.baseTopic;

      // Handle bridge/devices - this is the main source of device definitions
      if (topic === `${baseTopic}/bridge/devices`) {
        this.handleBridgeDevices(message);
        return;
      }

      // Handle bridge/state
      if (topic === `${baseTopic}/bridge/state`) {
        logger.debug('Bridge state:', message);
        return;
      }

      // Handle bridge/groups
      if (topic === `${baseTopic}/bridge/groups`) {
        logger.debug('Bridge groups received');
        return;
      }

      // Handle device availability
      if (topic.endsWith('/availability')) {
        const friendlyName = topic.replace(`${baseTopic}/`, '').replace('/availability', '');
        this.handleDeviceAvailability(friendlyName, message);
        return;
      }

      // Handle device state updates
      if (topic.startsWith(baseTopic) && !topic.includes('/bridge/') && !topic.includes('/availability')) {
        const friendlyName = topic.replace(`${baseTopic}/`, '').split('/')[0];
        this.handleDeviceState(friendlyName, message);
        return;
      }
    } catch (error) {
      logger.error(`Error handling message from ${topic}:`, error);
    }
  }

  private handleBridgeDevices(message: string): void {
    try {
      const devices: Z2MDevice[] = JSON.parse(message);
      logger.info(`Discovered ${devices.length} devices`);

      devices.forEach(device => {
        // Skip coordinator
        if (device.type === 'Coordinator') {
          return;
        }

        // Process each device in isolation: a single malformed/conflicting device must
        // never abort the whole batch and leave the rest of the network undiscovered.
        try {
          this.discovery.processDevice(device);
        } catch (error) {
          logger.error(
            `Skipping device ${device.friendly_name} (${device.ieee_address}):`,
            error
          );
        }
      });

      const stats = this.db.getStats();
      logger.debug(`Database: ${stats.deviceCount} devices, ${stats.fieldCount} fields, ${stats.capabilityCount} capabilities`);
    } catch (error) {
      logger.error('Error processing bridge/devices:', error);
    }
  }

  private handleDeviceAvailability(friendlyName: string, message: string): void {
    try {
      const data = JSON.parse(message);
      const device = this.db.getDevice(friendlyName);

      if (device) {
        // Update availability in current state
        const currentState = this.db.getDeviceState(device.ieee_address) || {};
        currentState.availability = data.state;
        this.db.updateDeviceState(device.ieee_address, currentState);

        // Update last_seen timestamp
        this.db.updateDeviceLastSeen(device.ieee_address);
      }
    } catch (error) {
      // Ignore non-JSON availability messages
    }
  }

  private handleDeviceState(friendlyName: string, message: string): void {
    try {
      const state = JSON.parse(message);
      const device = this.db.getDevice(friendlyName);

      if (!device) {
        // Device not yet known, might be a new device
        logger.debug(`Received state for unknown device: ${friendlyName}`);
        return;
      }

      // Update current state
      this.db.updateDeviceState(device.ieee_address, state);

      // Update last_seen timestamp
      this.db.updateDeviceLastSeen(device.ieee_address);

      // Learn from the state message - discover new fields
      this.discovery.processDeviceState(device.ieee_address, state);
    } catch (error) {
      // Ignore non-JSON messages
    }
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end(false, {}, () => {
          logger.debug('Disconnected from MQTT broker');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }

  // Method to publish commands (for controlling devices)
  async publishCommand(friendlyName: string, command: Record<string, any>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.client.connected) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      const topic = `${this.config.baseTopic}/${friendlyName}/set`;
      const payload = JSON.stringify(command);

      this.client.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
          reject(error);
        } else {
          logger.debug(`Published command to ${topic}:`, payload);
          resolve();
        }
      });
    });
  }
}
