import { ZigbeeDatabase } from './database.js';
import { Z2MDevice, Z2MExpose, DatabaseDevice, DeviceField, DeviceCapability } from './types.js';
import { logger } from './logger.js';

export class SchemaDiscovery {
  private db: ZigbeeDatabase;

  constructor(db: ZigbeeDatabase) {
    this.db = db;
  }

  /**
   * Process a device from ZigBee2MQTT bridge/devices message
   * This extracts the device definition and its capabilities
   */
  processDevice(device: Z2MDevice): void {
    // Store basic device information
    const dbDevice: DatabaseDevice = {
      ieee_address: device.ieee_address,
      friendly_name: device.friendly_name,
      model: device.definition?.model,
      vendor: device.definition?.vendor,
      description: device.definition?.description,
      device_type: device.type,
    };

    this.db.upsertDevice(dbDevice);

    // Process exposes (capabilities and fields)
    if (device.definition?.exposes) {
      device.definition.exposes.forEach(expose => {
        this.processExpose(device.ieee_address, expose);
      });
    }
  }

  /**
   * Process an expose definition from ZigBee2MQTT
   * Exposes define what capabilities and fields a device has
   */
  private processExpose(ieeeAddress: string, expose: Z2MExpose, parentName?: string): void {
    // Handle composite exposes (like "light" which contains multiple features)
    if (expose.type === 'light' || expose.type === 'switch' || expose.type === 'climate' || expose.type === 'cover' || expose.type === 'lock') {
      // Store as capability
      const capability: DeviceCapability = {
        ieee_address: ieeeAddress,
        capability_name: expose.type,
        capability_type: expose.type,
        access: this.parseAccess(expose.access),
      };
      this.db.upsertDeviceCapability(capability);

      // Process features within this expose
      if (expose.features) {
        expose.features.forEach(feature => {
          this.processExpose(ieeeAddress, feature, expose.type);
        });
      }
      return;
    }

    // Handle individual properties
    const propertyName = expose.property || expose.name;
    if (!propertyName) return;

    // Determine field type
    let fieldType: DeviceField['field_type'] = 'string';
    let enumValues: string[] | undefined;
    let valueMin: number | undefined;
    let valueMax: number | undefined;

    if (expose.type === 'binary') {
      fieldType = 'boolean';
      enumValues = expose.values; // ON/OFF, true/false, etc.
    } else if (expose.type === 'enum') {
      fieldType = 'enum';
      enumValues = expose.values;
    } else if (expose.type === 'numeric') {
      fieldType = 'number';
      valueMin = expose.value_min;
      valueMax = expose.value_max;
    } else if (expose.type === 'composite') {
      fieldType = 'object';
      // Process nested features
      if (expose.features) {
        expose.features.forEach(feature => {
          this.processExpose(ieeeAddress, feature, propertyName);
        });
      }
      return;
    }

    // Store field schema
    const field: DeviceField = {
      ieee_address: ieeeAddress,
      field_name: propertyName,
      field_type: fieldType,
      value_min: valueMin,
      value_max: valueMax,
      enum_values: enumValues,
      unit: expose.unit,
      description: expose.description,
    };

    this.db.upsertDeviceField(field);

    // Extract capabilities from specific properties
    this.extractCapabilitiesFromProperty(ieeeAddress, propertyName, expose);
  }

  /**
   * Extract high-level capabilities from properties
   * E.g., if a device has "brightness" property, it's dimmable
   */
  private extractCapabilitiesFromProperty(ieeeAddress: string, property: string, expose: Z2MExpose): void {
    const capabilityMap: Record<string, string> = {
      'state': 'on_off',
      'brightness': 'brightness',
      'color_temp': 'color_temperature',
      'color': 'color',
      'position': 'position',
      'temperature': 'temperature_sensor',
      'humidity': 'humidity_sensor',
      'pressure': 'pressure_sensor',
      'contact': 'contact_sensor',
      'occupancy': 'occupancy_sensor',
      'illuminance': 'light_sensor',
      'battery': 'battery',
      'action': 'action',
      'click': 'button',
    };

    const capabilityType = capabilityMap[property.toLowerCase()];
    if (capabilityType) {
      const capability: DeviceCapability = {
        ieee_address: ieeeAddress,
        capability_name: property,
        capability_type: capabilityType,
        access: this.parseAccess(expose.access),
      };
      this.db.upsertDeviceCapability(capability);
    }
  }

  /**
   * Process actual device state messages to learn structure dynamically
   * This helps discover fields that might not be in the static definition
   */
  processDeviceState(ieeeAddress: string, state: Record<string, any>, prefix: string = ''): void {
    Object.entries(state).forEach(([key, value]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      // Skip internal fields
      if (key === 'linkquality' || key === 'last_seen' || key === 'elapsed') {
        return;
      }

      // Determine type from value
      let fieldType: DeviceField['field_type'] = 'string';
      let enumValues: string[] | undefined;

      if (typeof value === 'boolean') {
        fieldType = 'boolean';
      } else if (typeof value === 'number') {
        fieldType = 'number';
      } else if (typeof value === 'object' && value !== null) {
        fieldType = 'object';
        // Recursively process nested objects
        this.processDeviceState(ieeeAddress, value, fullKey);
        return;
      } else if (typeof value === 'string') {
        // Check if this looks like an enum (common values: ON/OFF, etc.)
        if (['ON', 'OFF', 'TOGGLE', 'open', 'close', 'closed'].includes(value)) {
          fieldType = 'enum';
        }
      }

      // Check if we already have this field
      const existingFields = this.db.getDeviceFields(ieeeAddress);
      const existingField = existingFields.find(f => f.field_name === fullKey);

      if (!existingField) {
        // New field discovered from actual data!
        const field: DeviceField = {
          ieee_address: ieeeAddress,
          field_name: fullKey,
          field_type: fieldType,
          enum_values: enumValues,
        };
        this.db.upsertDeviceField(field);
        logger.debug(`Discovered new field: ${fullKey} (${fieldType})`);
      }
    });
  }

  /**
   * Parse ZigBee2MQTT access flags
   * Access is a bitmask: 1=read, 2=write, 4=publish
   */
  private parseAccess(access?: number): string {
    if (access === undefined) return 'unknown';

    const flags: string[] = [];
    if (access & 1) flags.push('read');
    if (access & 2) flags.push('write');
    if (access & 4) flags.push('publish');

    return flags.join(',') || 'none';
  }
}
