// Database types
export interface DatabaseDevice {
  ieee_address: string;
  friendly_name: string;
  model?: string;
  vendor?: string;
  description?: string;
  device_type?: string;
  disabled: boolean;
  last_seen?: number;
  created_at?: number;
  updated_at?: number;
}

export interface DeviceField {
  id?: number;
  ieee_address: string;
  field_name: string;
  field_type: 'string' | 'number' | 'boolean' | 'enum' | 'object';
  value_min?: number;
  value_max?: number;
  enum_values?: string[];
  unit?: string;
  description?: string;
  created_at?: number;
}

export interface DeviceCapability {
  id?: number;
  ieee_address: string;
  capability_name: string;
  capability_type: string;
  access?: string;
  created_at?: number;
}

export interface DeviceState {
  ieee_address: string;
  state_json: string;
  updated_at: number;
}

// ZigBee2MQTT types (from bridge/devices payload)
export interface Z2MDevice {
  ieee_address: string;
  type: string;
  network_address?: number;
  supported: boolean;
  friendly_name: string;
  definition?: {
    model: string;
    vendor: string;
    description: string;
    exposes?: Z2MExpose[];
  };
  power_source?: string;
  disabled?: boolean;
  endpoints?: Record<string, any>;
}

export interface Z2MExpose {
  type: string;
  name?: string;
  property?: string;
  access?: number;
  description?: string;
  unit?: string;
  value_min?: number;
  value_max?: number;
  value_step?: number;
  values?: string[];
  features?: Z2MExpose[];
  endpoint?: string;
}

// MCP Response types
export interface DeviceInfo {
  ieee_address: string;
  friendly_name: string;
  model?: string;
  vendor?: string;
  description?: string;
  device_type?: string;
  disabled: boolean;
  fields: DeviceFieldInfo[];
  capabilities: string[];
  current_state?: Record<string, any>;
  created_at?: number;
  last_seen?: number;
  updated_at?: number;
}

export interface DeviceFieldInfo {
  name: string;
  type: string;
  min?: number;
  max?: number;
  values?: string[];
  unit?: string;
  description?: string;
}

export interface IntegrationInfo {
  device: string;
  mqtt_topic_get: string;
  mqtt_topic_set: string;
  available_commands: Record<string, any>;
  example_payloads: {
    read_state: string;
    set_commands: Record<string, string>;
  };
}
