import Database from 'better-sqlite3';
import { DatabaseDevice, DeviceField, DeviceCapability, DeviceState } from './types.js';

export class ZigbeeDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    // Devices table - basic device information
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        ieee_address TEXT PRIMARY KEY,
        friendly_name TEXT NOT NULL UNIQUE,
        model TEXT,
        vendor TEXT,
        description TEXT,
        device_type TEXT,
        last_seen INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_devices_friendly_name ON devices(friendly_name);
    `);

    // Device fields - schema/structure of each device's data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ieee_address TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_type TEXT NOT NULL,
        value_min REAL,
        value_max REAL,
        enum_values TEXT,
        unit TEXT,
        description TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (ieee_address) REFERENCES devices(ieee_address) ON DELETE CASCADE,
        UNIQUE(ieee_address, field_name)
      );
      CREATE INDEX IF NOT EXISTS idx_device_fields_ieee ON device_fields(ieee_address);
    `);

    // Device capabilities - what actions can be performed
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_capabilities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ieee_address TEXT NOT NULL,
        capability_name TEXT NOT NULL,
        capability_type TEXT NOT NULL,
        access TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (ieee_address) REFERENCES devices(ieee_address) ON DELETE CASCADE,
        UNIQUE(ieee_address, capability_name)
      );
      CREATE INDEX IF NOT EXISTS idx_device_capabilities_ieee ON device_capabilities(ieee_address);
      CREATE INDEX IF NOT EXISTS idx_device_capabilities_type ON device_capabilities(capability_type);
    `);

    // Current device states - only the latest value for each field
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS current_states (
        ieee_address TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (ieee_address) REFERENCES devices(ieee_address) ON DELETE CASCADE
      );
    `);
  }

  // Device operations
  upsertDevice(device: DatabaseDevice): void {
    const now = Date.now();

    // friendly_name has a UNIQUE constraint, but ieee_address is the stable identity.
    // When a device is renamed or re-paired, its friendly_name migrates to a different
    // ieee_address. Z2M guarantees friendly_name is globally unique, so any existing row
    // holding this name under a *different* ieee is stale — drop it first, otherwise the
    // ieee-keyed upsert below hits the UNIQUE(friendly_name) constraint and the whole
    // bridge/devices batch aborts mid-way.
    this.db
      .prepare(`DELETE FROM devices WHERE friendly_name = ? AND ieee_address != ?`)
      .run(device.friendly_name, device.ieee_address);

    const stmt = this.db.prepare(`
      INSERT INTO devices (ieee_address, friendly_name, model, vendor, description, device_type, last_seen, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ieee_address) DO UPDATE SET
        friendly_name = excluded.friendly_name,
        model = excluded.model,
        vendor = excluded.vendor,
        description = excluded.description,
        device_type = excluded.device_type,
        last_seen = excluded.last_seen,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      device.ieee_address,
      device.friendly_name,
      device.model || null,
      device.vendor || null,
      device.description || null,
      device.device_type || null,
      device.last_seen || now,
      now,
      now
    );
  }

  getDevice(identifier: string): DatabaseDevice | null {
    const stmt = this.db.prepare(`
      SELECT * FROM devices WHERE ieee_address = ? OR friendly_name = ?
    `);
    return stmt.get(identifier, identifier) as DatabaseDevice | null;
  }

  getAllDevices(): DatabaseDevice[] {
    const stmt = this.db.prepare('SELECT * FROM devices ORDER BY friendly_name');
    return stmt.all() as DatabaseDevice[];
  }

  searchDevices(query: string): DatabaseDevice[] {
    const stmt = this.db.prepare(`
      SELECT * FROM devices
      WHERE friendly_name LIKE ? OR model LIKE ? OR description LIKE ?
      ORDER BY friendly_name
    `);
    const searchPattern = `%${query}%`;
    return stmt.all(searchPattern, searchPattern, searchPattern) as DatabaseDevice[];
  }

  // Field operations
  upsertDeviceField(field: DeviceField): void {
    const stmt = this.db.prepare(`
      INSERT INTO device_fields (ieee_address, field_name, field_type, value_min, value_max, enum_values, unit, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ieee_address, field_name) DO UPDATE SET
        field_type = excluded.field_type,
        value_min = excluded.value_min,
        value_max = excluded.value_max,
        enum_values = excluded.enum_values,
        unit = excluded.unit,
        description = excluded.description
    `);

    stmt.run(
      field.ieee_address,
      field.field_name,
      field.field_type,
      field.value_min ?? null,
      field.value_max ?? null,
      field.enum_values ? JSON.stringify(field.enum_values) : null,
      field.unit ?? null,
      field.description ?? null,
      Date.now()
    );
  }

  getDeviceFields(ieeeAddress: string): DeviceField[] {
    const stmt = this.db.prepare('SELECT * FROM device_fields WHERE ieee_address = ?');
    const rows = stmt.all(ieeeAddress) as any[];
    return rows.map(row => ({
      ...row,
      enum_values: row.enum_values ? JSON.parse(row.enum_values) : undefined
    }));
  }

  // Capability operations
  upsertDeviceCapability(capability: DeviceCapability): void {
    const stmt = this.db.prepare(`
      INSERT INTO device_capabilities (ieee_address, capability_name, capability_type, access, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ieee_address, capability_name) DO UPDATE SET
        capability_type = excluded.capability_type,
        access = excluded.access
    `);

    stmt.run(
      capability.ieee_address,
      capability.capability_name,
      capability.capability_type,
      capability.access ?? null,
      Date.now()
    );
  }

  getDeviceCapabilities(ieeeAddress: string): DeviceCapability[] {
    const stmt = this.db.prepare('SELECT * FROM device_capabilities WHERE ieee_address = ?');
    return stmt.all(ieeeAddress) as DeviceCapability[];
  }

  findDevicesByCapability(capabilityType: string): DatabaseDevice[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT d.* FROM devices d
      INNER JOIN device_capabilities dc ON d.ieee_address = dc.ieee_address
      WHERE dc.capability_type = ?
      ORDER BY d.friendly_name
    `);
    return stmt.all(capabilityType) as DatabaseDevice[];
  }

  // State operations
  updateDeviceState(ieeeAddress: string, state: Record<string, any>): void {
    const stmt = this.db.prepare(`
      INSERT INTO current_states (ieee_address, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(ieee_address) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `);

    stmt.run(ieeeAddress, JSON.stringify(state), Date.now());
  }

  getDeviceState(ieeeAddress: string): Record<string, any> | null {
    const stmt = this.db.prepare('SELECT state_json FROM current_states WHERE ieee_address = ?');
    const row = stmt.get(ieeeAddress) as { state_json: string } | undefined;
    return row ? JSON.parse(row.state_json) : null;
  }

  // Update last_seen timestamp when device sends a message
  updateDeviceLastSeen(ieeeAddress: string): void {
    const stmt = this.db.prepare(`
      UPDATE devices
      SET last_seen = ?, updated_at = ?
      WHERE ieee_address = ?
    `);

    const now = Date.now();
    stmt.run(now, now, ieeeAddress);
  }

  // Get devices added in the last N days
  getRecentDevices(daysAgo: number): DatabaseDevice[] {
    const cutoffTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM devices
      WHERE created_at >= ?
      ORDER BY created_at DESC
    `);
    return stmt.all(cutoffTime) as DatabaseDevice[];
  }

  // Utility
  close(): void {
    this.db.close();
  }

  getStats(): { deviceCount: number; fieldCount: number; capabilityCount: number } {
    const deviceCount = this.db.prepare('SELECT COUNT(*) as count FROM devices').get() as { count: number };
    const fieldCount = this.db.prepare('SELECT COUNT(*) as count FROM device_fields').get() as { count: number };
    const capabilityCount = this.db.prepare('SELECT COUNT(*) as count FROM device_capabilities').get() as { count: number };

    return {
      deviceCount: deviceCount.count,
      fieldCount: fieldCount.count,
      capabilityCount: capabilityCount.count
    };
  }
}
