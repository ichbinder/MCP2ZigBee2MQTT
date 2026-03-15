export type LogicalDeviceMapping =
  | {
      kind: 'switch';
      physicalDevice: string;     // 物理设备 friendly_name
      stateKey: string;           // state_left/state_right 等
      description?: string;
    }
  | {
      kind: 'cover';
      physicalDevice: string;     // 物理窗帘设备 friendly_name
      invert?: boolean;           // 可选：开合百分比是否反向
      description?: string;
    };

export const LOGICAL_DEVICES: Record<string, LogicalDeviceMapping> = {
  // 逻辑设备名 -> 映射到物理设备 + key
  "Living Room Light": {
    kind: 'switch',
    physicalDevice: "Zigbee2MQTTDeviceName",
    stateKey: "state",
    description: "Description"
  },


  'Room Cover': {
    kind: 'cover',
    physicalDevice: 'Zigbee2mqttDeviceName',   // ← 这里改成你实际设备名
    invert: false,                   // 如发现方向反了，改 true
    description: 'Desciption(for OPEN/CLOSE/STOP + position 0..100)',
  }
 
  // Add More devices


};
