import { BleClient, numberToUUID } from '@capacitor-community/bluetooth-le';
import { SplashScreen } from '@capacitor/splash-screen';
import { LocalNotifications } from '@capacitor/local-notifications';
import { CODatabase, PathFinder } from './pathfinding.js';
import * as tf from '@tensorflow/tfjs';

// Hide splash screen once app is ready
SplashScreen.hide();

// =====================================================
// CO Safety Thresholds (based on OSHA/EPA guidelines)
// =====================================================
// Sources: OSHA, EPA, WHO guidelines for carbon monoxide exposure
const CO_THRESHOLDS = {
  // 35 ppm - OSHA 8-hour TWA limit, symptoms may occur with prolonged exposure
  WARNING: 35,
  // 70 ppm - Noticeable symptoms (headache, dizziness) within 1-4 hours
  DANGER: 70,
  // 150 ppm - Life-threatening, requires immediate evacuation
  CRITICAL: 150
};

// Notification cooldown to prevent spam (in milliseconds)
const NOTIFICATION_COOLDOWN = 60000; // 1 minute between same-level notifications
let lastNotificationTime = {
  warning: 0,
  danger: 0,
  critical: 0
};
let notificationsEnabled = false;

// =====================================================
// ESP32 BLE Configuration
// =====================================================
// TODO: Update these UUIDs to match your ESP32 firmware
// Common ESP32 BLE configurations use custom 128-bit UUIDs

// Option 1: Standard Environmental Sensing Service (if your ESP32 uses it)
const ENV_SENSING_SERVICE = '0000181a-0000-1000-8000-00805f9b34fb';
const TEMPERATURE_CHAR = '00002a6e-0000-1000-8000-00805f9b34fb';
const HUMIDITY_CHAR = '00002a6f-0000-1000-8000-00805f9b34fb';
const PRESSURE_CHAR = '00002a6d-0000-1000-8000-00805f9b34fb';

// Option 2: Custom ESP32 Service (more common for custom sensors)
// Change these to match your ESP32's UUIDs
const ESP32_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const ESP32_SENSOR_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

// Configuration - set to true if your ESP32 sends all data in one characteristic
const USE_SINGLE_CHARACTERISTIC = true;

// Screen elements
const homeScreen = document.getElementById('home-screen');
const monitorScreen = document.getElementById('monitor-screen');
const escapeScreen = document.getElementById('escape-screen');
const connectBtn = document.getElementById('connect-btn');
const escapeBtn = document.getElementById('escape-btn');
const backBtn = document.getElementById('back-btn');
const escapeBackBtn = document.getElementById('escape-back-btn');
const connectionStatus = document.getElementById('connection-status');

// Device picker modal elements
const deviceModal = document.getElementById('device-modal');
const deviceList = document.getElementById('device-list');
const modalStatus = document.getElementById('modal-status');
const showMoreBtn = document.getElementById('show-more-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');
const rescanBtn = document.getElementById('rescan-btn');
const cancelScanBtn = document.getElementById('cancel-scan-btn');

// Device picker state
const DEVICES_PER_PAGE = 3;
let discoveredDevices = [];
let visibleDeviceCount = DEVICES_PER_PAGE;
let isScanning = false;

// Sensor value elements
const temperatureValue = document.getElementById('temperature-value');
const humidityValue = document.getElementById('humidity-value');
const coCurrentValue = document.getElementById('co-current-value');
const coPredictedValue = document.getElementById('co-predicted-value');
const modelStatus = document.getElementById('model-status');

// CO history buffer for GRU model (stores recent readings)
const CO_HISTORY_SIZE = 10; // Number of past readings for time-series input (matches model input shape)
let sensorHistory = []; // Stores arrays of [temp, humidity, pressure, co]
let rawCOHistory = []; // Stores raw CO values for fallback prediction
let gruModel = null;
let gruModelLoaded = false;
let gruWeightsLoaded = false; // Track if actual trained weights are loaded

// Normalization parameters (should match training data normalization)
// These are placeholder values - update with actual min/max from your training data
const NORM_PARAMS = {
  temp: { min: 0, max: 50 },      // Temperature range in °C
  humidity: { min: 0, max: 100 }, // Humidity range in %
  pressure: { min: 900, max: 1100 }, // Pressure range in hPa
  co: { min: 0, max: 100 }        // CO range in ppm
};

// BLE Connection state
let isConnected = false;
let connectedDevice = null;
let monitoringInterval = null;

// =====================================================
// CO Alert Notifications
// =====================================================

/**
 * Initialize local notifications and request permissions
 */
async function initializeNotifications() {
  try {
    // Request notification permissions
    const permStatus = await LocalNotifications.requestPermissions();
    
    if (permStatus.display === 'granted') {
      notificationsEnabled = true;
      console.log('Notifications enabled');
      
      // Register notification action types
      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: 'CO_ALERT',
            actions: [
              { id: 'view', title: 'View Details' },
              { id: 'dismiss', title: 'Dismiss', destructive: true }
            ]
          }
        ]
      });
    } else {
      console.log('Notification permission denied');
      notificationsEnabled = false;
    }
  } catch (error) {
    console.error('Failed to initialize notifications:', error);
    notificationsEnabled = false;
  }
}

/**
 * Check CO levels and send appropriate notifications
 * @param {number} currentCO - Current CO reading in ppm
 * @param {number|null} predictedCO - Predicted CO level in ppm (can be null)
 */
async function checkCOAndNotify(currentCO, predictedCO) {
  if (!notificationsEnabled) return;
  
  const now = Date.now();
  const parsedCurrent = parseFloat(currentCO);
  const parsedPredicted = predictedCO !== null ? parseFloat(predictedCO) : null;
  
  // Check current CO level
  if (!isNaN(parsedCurrent)) {
    await sendCONotification(parsedCurrent, 'current', now);
  }
  
  // Check predicted CO level (if available and different threshold)
  if (parsedPredicted !== null && !isNaN(parsedPredicted)) {
    await sendCONotification(parsedPredicted, 'predicted', now);
  }
}

/**
 * Send notification based on CO level
 * @param {number} coLevel - CO level in ppm
 * @param {string} type - 'current' or 'predicted'
 * @param {number} now - Current timestamp
 */
async function sendCONotification(coLevel, type, now) {
  let level = null;
  let title = '';
  let body = '';
  let notificationId = 0;
  
  const typeLabel = type === 'predicted' ? 'Predicted ' : '';
  
  if (coLevel >= CO_THRESHOLDS.CRITICAL) {
    level = 'critical';
    title = '🚨 CRITICAL: Evacuate Immediately!';
    body = `${typeLabel}CO level: ${coLevel.toFixed(1)} ppm - Life-threatening! Leave the area NOW and call emergency services.`;
    notificationId = type === 'predicted' ? 3 : 6;
  } else if (coLevel >= CO_THRESHOLDS.DANGER) {
    level = 'danger';
    title = '⚠️ DANGER: High CO Detected!';
    body = `${typeLabel}CO level: ${coLevel.toFixed(1)} ppm - Dangerous level! Ventilate area immediately and prepare to evacuate.`;
    notificationId = type === 'predicted' ? 2 : 5;
  } else if (coLevel >= CO_THRESHOLDS.WARNING) {
    level = 'warning';
    title = '⚡ WARNING: Elevated CO Level';
    body = `${typeLabel}CO level: ${coLevel.toFixed(1)} ppm - Above safe limit. Open windows and check for CO sources.`;
    notificationId = type === 'predicted' ? 1 : 4;
  }
  
  // Only send notification if threshold exceeded and cooldown passed
  if (level && (now - lastNotificationTime[level] > NOTIFICATION_COOLDOWN)) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notificationId,
            title: title,
            body: body,
            actionTypeId: 'CO_ALERT',
            extra: {
              coLevel: coLevel,
              type: type,
              level: level
            },
            schedule: { at: new Date(Date.now()) },
            sound: level === 'critical' ? 'alarm.wav' : 'default',
            smallIcon: 'ic_stat_warning',
            largeIcon: 'ic_launcher',
            attachments: null,
            ongoing: level === 'critical' // Critical stays until dismissed
          }
        ]
      });
      
      lastNotificationTime[level] = now;
      console.log(`Sent ${level} notification for ${type} CO: ${coLevel} ppm`);
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }
}

/**
 * Get the current CO alert status based on level
 * @param {number} coLevel - CO level in ppm
 * @returns {object} Alert status with level and message
 */
function getCOAlertStatus(coLevel) {
  if (coLevel >= CO_THRESHOLDS.CRITICAL) {
    return { level: 'critical', color: '#ff0000', message: 'EVACUATE NOW!' };
  } else if (coLevel >= CO_THRESHOLDS.DANGER) {
    return { level: 'danger', color: '#ff5722', message: 'DANGER - Ventilate!' };
  } else if (coLevel >= CO_THRESHOLDS.WARNING) {
    return { level: 'warning', color: '#ff9800', message: 'Elevated' };
  } else {
    return { level: 'safe', color: '#4caf50', message: 'Safe' };
  }
}

// Initialize notifications on app start
initializeNotifications();

// Navigation functions
function showScreen(screen) {
  homeScreen.classList.remove('active');
  monitorScreen.classList.remove('active');
  escapeScreen.classList.remove('active');
  screen.classList.add('active');
}

function goToMonitor() {
  showScreen(monitorScreen);
  startMonitoring();
}

function goToEscape() {
  showScreen(escapeScreen);
  initializeEscapeScreen();
}

function goToHome() {
  showScreen(homeScreen);
  stopMonitoring();
  stopEscapeScreen();
}

// =====================================================
// ESP32 BLE Connection
// =====================================================

/**
 * Show device picker modal and scan for devices
 */
async function showDevicePicker() {
  // Reset state
  discoveredDevices = [];
  visibleDeviceCount = DEVICES_PER_PAGE;
  deviceList.innerHTML = '';
  showMoreBtn.style.display = 'none';
  
  // Show modal
  deviceModal.classList.add('active');
  modalStatus.textContent = 'Scanning for devices...';
  modalStatus.className = 'modal-status scanning';
  
  try {
    // Initialize BLE
    await BleClient.initialize({ androidNeverForLocation: true });
    
    // Start scanning for devices
    isScanning = true;
    await BleClient.requestLEScan(
      {
        services: [ESP32_SERVICE_UUID, ENV_SENSING_SERVICE],
        allowDuplicates: false,
      },
      (result) => {
        handleDeviceFound(result);
      }
    );
    
    // Stop scanning after 10 seconds
    setTimeout(() => {
      stopScanning();
    }, 10000);
    
  } catch (error) {
    console.error('Scan error:', error);
    modalStatus.textContent = 'Scan failed. Please try again.';
    modalStatus.className = 'modal-status error';
    
    // Show "no devices" message
    deviceList.innerHTML = `
      <div class="no-devices">
        <div class="no-devices-icon">📡</div>
        <div class="no-devices-text">Could not start scan. Make sure Bluetooth is enabled.</div>
      </div>
    `;
  }
}

/**
 * Handle a discovered device
 */
function handleDeviceFound(result) {
  const device = result.device;
  
  // Check if device already in list
  const existingIndex = discoveredDevices.findIndex(d => d.deviceId === device.deviceId);
  if (existingIndex !== -1) {
    // Update RSSI if device already exists
    discoveredDevices[existingIndex].rssi = result.rssi;
    return;
  }
  
  // Add new device
  discoveredDevices.push({
    ...device,
    rssi: result.rssi
  });
  
  // Update modal status
  modalStatus.textContent = `Found ${discoveredDevices.length} device(s)`;
  modalStatus.className = 'modal-status';
  
  // Render device list
  renderDeviceList();
}

/**
 * Render the device list with pagination
 */
function renderDeviceList() {
  if (discoveredDevices.length === 0) {
    deviceList.innerHTML = `
      <div class="no-devices">
        <div class="no-devices-icon">📡</div>
        <div class="no-devices-text">Scanning for nearby devices...</div>
      </div>
    `;
    showMoreBtn.style.display = 'none';
    return;
  }
  
  // Sort devices by RSSI (strongest signal first)
  const sortedDevices = [...discoveredDevices].sort((a, b) => (b.rssi || -100) - (a.rssi || -100));
  
  deviceList.innerHTML = '';
  
  sortedDevices.forEach((device, index) => {
    const deviceItem = createDeviceItem(device, index);
    deviceList.appendChild(deviceItem);
  });
  
  // Show/hide "show more" button
  if (discoveredDevices.length > visibleDeviceCount) {
    showMoreBtn.style.display = 'block';
    showMoreBtn.textContent = `Show More (${discoveredDevices.length - visibleDeviceCount} more)`;
  } else {
    showMoreBtn.style.display = 'none';
  }
}

/**
 * Create a device item element
 */
function createDeviceItem(device, index) {
  const isVisible = index < visibleDeviceCount;
  const rssi = device.rssi || -100;
  const signalBars = getRSSIBars(rssi);
  
  const div = document.createElement('div');
  div.className = `device-item${isVisible ? '' : ' hidden'}`;
  div.innerHTML = `
    <div class="device-icon">📱</div>
    <div class="device-info">
      <div class="device-name">${device.name || 'Unknown Device'}</div>
      <div class="device-id">${device.deviceId.substring(0, 20)}...</div>
    </div>
    <div class="device-rssi">
      <div class="rssi-bar">
        ${signalBars}
      </div>
    </div>
  `;
  
  div.addEventListener('click', () => {
    selectDevice(device);
  });
  
  return div;
}

/**
 * Get RSSI signal bars HTML
 */
function getRSSIBars(rssi) {
  // RSSI ranges: -30 excellent, -67 good, -70 fair, -80 weak, -90 very weak
  let activeBars = 1;
  if (rssi >= -50) activeBars = 4;
  else if (rssi >= -60) activeBars = 3;
  else if (rssi >= -70) activeBars = 2;
  else activeBars = 1;
  
  let html = '';
  for (let i = 1; i <= 4; i++) {
    html += `<span class="${i <= activeBars ? 'active' : ''}"></span>`;
  }
  return html;
}

/**
 * Show more devices
 */
function showMoreDevices() {
  visibleDeviceCount += DEVICES_PER_PAGE;
  renderDeviceList();
  
  // Update visibility of device items
  const items = deviceList.querySelectorAll('.device-item');
  items.forEach((item, index) => {
    if (index < visibleDeviceCount) {
      item.classList.remove('hidden');
    }
  });
}

/**
 * Stop BLE scanning
 */
async function stopScanning() {
  if (isScanning) {
    try {
      await BleClient.stopLEScan();
    } catch (error) {
      console.log('Error stopping scan:', error);
    }
    isScanning = false;
  }
  
  if (discoveredDevices.length === 0) {
    modalStatus.textContent = 'No devices found';
    modalStatus.className = 'modal-status';
    deviceList.innerHTML = `
      <div class="no-devices">
        <div class="no-devices-icon">📡</div>
        <div class="no-devices-text">No devices found. Make sure your ESP32 is powered on.</div>
      </div>
    `;
  } else {
    modalStatus.textContent = `Found ${discoveredDevices.length} device(s) - Tap to connect`;
    modalStatus.className = 'modal-status';
  }
}

/**
 * Close the device picker modal
 */
function closeDevicePicker() {
  stopScanning();
  deviceModal.classList.remove('active');
}

/**
 * Select a device and connect
 */
async function selectDevice(device) {
  stopScanning();
  closeDevicePicker();
  
  // Navigate to monitor screen
  goToMonitor();
  
  // Connect to the selected device
  await connectToDevice(device);
}

/**
 * Initialize BLE and connect to ESP32 device
 */
async function connectToESP32() {
  try {
    // Initialize BLE
    await BleClient.initialize({ androidNeverForLocation: true });
    connectionStatus.textContent = 'Scanning for ESP32...';
    
    // Request device - this shows a device picker to the user
    // Filter by name prefix or service UUID
    const device = await BleClient.requestDevice({
      // Filter by service UUID (recommended)
      optionalServices: [ESP32_SERVICE_UUID, ENV_SENSING_SERVICE],
      namePrefix: 'CODetect', // Uncomment if your ESP32 has a specific name prefix
      // Or filter by name prefix (uncomment if your ESP32 has a specific name)
      // namePrefix: 'CODetect',
      // namePrefix: 'ESP32',
    });
    
    console.log('Selected device:', device);
    await connectToDevice(device);
    
  } catch (error) {
    console.error('BLE Connection error:', error);
    
    if (error.message?.includes('cancelled') || error.message?.includes('canceled')) {
      connectionStatus.textContent = 'Connection cancelled';
    } else {
      connectionStatus.textContent = `Error: ${error.message || 'Connection failed'}`;
    }
    connectionStatus.style.color = '#f44336';
    
    // Offer retry or demo mode
    setTimeout(() => {
      if (!isConnected) {
        connectionStatus.textContent = 'Tap to retry or using demo mode...';
        startDemoMode();
      }
    }, 3000);
  }
}

/**
 * Connect to a selected BLE device
 */
async function connectToDevice(device) {
  try {
    connectionStatus.textContent = `Connecting to ${device.name || 'ESP32'}...`;
    
    // Connect to the device
    await BleClient.connect(device.deviceId, (deviceId) => {
      // Disconnection callback
      console.log('Device disconnected:', deviceId);
      handleDisconnection();
    });
    
    connectedDevice = device;
    isConnected = true;
    connectionStatus.textContent = `Connected to ${device.name || 'ESP32'}`;
    connectionStatus.style.color = '#31d53d';
    
    // Initialize GRU model
    initializeGRUModel();
    
    // Start receiving sensor data
    await subscribeToSensorData(device.deviceId);
    
  } catch (error) {
    console.error('BLE Connection error:', error);
    connectionStatus.textContent = `Error: ${error.message || 'Connection failed'}`;
    connectionStatus.style.color = '#f44336';
    
    // Offer demo mode
    setTimeout(() => {
      if (!isConnected) {
        connectionStatus.textContent = 'Using demo mode...';
        startDemoMode();
      }
    }, 3000);
  }
}

// Modal event listeners
showMoreBtn.addEventListener('click', showMoreDevices);
modalCloseBtn.addEventListener('click', closeDevicePicker);
cancelScanBtn.addEventListener('click', closeDevicePicker);
rescanBtn.addEventListener('click', () => {
  stopScanning();
  discoveredDevices = [];
  visibleDeviceCount = DEVICES_PER_PAGE;
  showDevicePicker();
});

/**
 * Subscribe to sensor data notifications from ESP32
 */
async function subscribeToSensorData(deviceId) {
  try {
    if (USE_SINGLE_CHARACTERISTIC) {
      // ESP32 sends all sensor data in one characteristic (common approach)
      await BleClient.startNotifications(
        deviceId,
        ESP32_SERVICE_UUID,
        ESP32_SENSOR_CHAR_UUID,
        (value) => {
          parseSensorData(value);
        }
      );
      console.log('Subscribed to sensor notifications');
    } else {
      // Subscribe to individual characteristics (standard BLE approach)
      await subscribeToIndividualCharacteristics(deviceId);
    }
  } catch (error) {
    console.error('Failed to subscribe to notifications:', error);
    connectionStatus.textContent = 'Failed to receive sensor data';
    
    // Try reading data periodically instead
    startPollingMode(deviceId);
  }
}

/**
 * Subscribe to individual standard BLE characteristics
 */
async function subscribeToIndividualCharacteristics(deviceId) {
  try {
    await BleClient.startNotifications(deviceId, ENV_SENSING_SERVICE, TEMPERATURE_CHAR, (value) => {
      const temp = parseTemperature(value);
      temperatureValue.textContent = temp.toFixed(1);
    });
    
    await BleClient.startNotifications(deviceId, ENV_SENSING_SERVICE, HUMIDITY_CHAR, (value) => {
      const humidity = parseHumidity(value);
      humidityValue.textContent = humidity.toFixed(1);
    });
    
    await BleClient.startNotifications(deviceId, ENV_SENSING_SERVICE, PRESSURE_CHAR, (value) => {
      const pressure = parsePressure(value);
      pressureValue.textContent = pressure.toFixed(1);
    });
  } catch (error) {
    console.error('Error subscribing to individual characteristics:', error);
    throw error;
  }
}

/**
 * Parse sensor data from ESP32
 * TODO: Adjust this based on your ESP32's data format
 * 
 * Common formats:
 * 1. JSON string: {"temp": 25.5, "humidity": 60.0, "pressure": 1013.25, "co": 5.2}
 * 2. CSV string: "25.5,60.0,1013.25,5.2"
 * 3. Binary: 4 floats (16 bytes total)
 */
function parseSensorData(dataView) {
  try {
    // Convert DataView to string for JSON/CSV parsing
    const decoder = new TextDecoder('utf-8');
    const dataString = decoder.decode(dataView.buffer);
    
    console.log('Received data:', dataString);
    
    // Try JSON format first
    if (dataString.startsWith('{')) {
      const data = JSON.parse(dataString);
      updateSensorDisplay(data.temp || data.temperature, data.humidity, data.pressure, data.co);
      return;
    }
    
    // Try CSV format: temp,humidity,pressure,co
    if (dataString.includes(',')) {
      const values = dataString.split(',').map(v => parseFloat(v.trim()));
      if (values.length >= 4) {
        updateSensorDisplay(values[0], values[1], values[2], values[3]);
        return;
      }
    }
    
    // Try binary format: 4 x 32-bit floats (little-endian)
    if (dataView.byteLength >= 16) {
      const temp = dataView.getFloat32(0, true);
      const humidity = dataView.getFloat32(4, true);
      const pressure = dataView.getFloat32(8, true);
      const co = dataView.getFloat32(12, true);
      updateSensorDisplay(temp, humidity, pressure, co);
      return;
    }
    
    console.warn('Unknown data format:', dataString);
  } catch (error) {
    console.error('Error parsing sensor data:', error);
  }
}

/**
 * Update the sensor display with new values
 */
function updateSensorDisplay(temp, humidity, pressure, co) {
  // FIRST: Update display immediately (before any model processing)
  if (temp !== undefined && !isNaN(temp)) {
    temperatureValue.textContent = temp.toFixed(1);
  }
  if (humidity !== undefined && !isNaN(humidity)) {
    humidityValue.textContent = humidity.toFixed(1);
  }
  if (co !== undefined && !isNaN(co)) {
    coCurrentValue.textContent = co.toFixed(1);
    
    // Apply color based on CO alert level
    const alertStatus = getCOAlertStatus(co);
    coCurrentValue.style.color = alertStatus.color;
    
    // Check CO level and send notification if needed (for current reading)
    checkCOAndNotify(co, null);
  }
  
  // THEN: Update sensor history and run prediction asynchronously
  // Use default values for missing sensor data
  const currentTemp = temp !== undefined && !isNaN(temp) ? temp : 25;
  const currentHumidity = humidity !== undefined && !isNaN(humidity) ? humidity : 50;
  const currentPressure = pressure !== undefined && !isNaN(pressure) ? pressure : 1013;
  const currentCO = co !== undefined && !isNaN(co) ? co : 0;
  
  // Update sensor history with all 4 features for GRU model
  updateSensorHistory(currentTemp, currentHumidity, currentPressure, currentCO);
  
  // Run prediction asynchronously to not block UI updates
  runPredictionAsync(currentCO);
}

/**
 * Run CO prediction asynchronously to prevent blocking UI
 * @param {number} currentCO - Current CO value for notification comparison
 */
async function runPredictionAsync(currentCO) {
  // Use requestAnimationFrame to yield to the browser first
  requestAnimationFrame(async () => {
    try {
      const predictedCO = await predictCOLevel(sensorHistory);
      if (predictedCO !== null) {
        coPredictedValue.textContent = predictedCO;
        coPredictedValue.style.fontSize = '';
        
        // Apply color based on predicted CO alert level
        const alertStatus = getCOAlertStatus(parseFloat(predictedCO));
        coPredictedValue.style.color = alertStatus.color;
        
        // Check predicted CO level and send notification if needed
        // Only notify for predicted if it's worse than current
        const predictedNum = parseFloat(predictedCO);
        if (predictedNum > currentCO) {
          checkCOAndNotify(currentCO, predictedCO);
        }
      } else {
        const remaining = CO_HISTORY_SIZE - sensorHistory.length;
        if (remaining > 0) {
          coPredictedValue.textContent = `Collecting... (${sensorHistory.length}/${CO_HISTORY_SIZE})`;
        } else {
          coPredictedValue.textContent = 'Predicting...';
        }
        coPredictedValue.style.fontSize = '1.8vh';
        coPredictedValue.style.color = ''; // Reset color
      }
    } catch (error) {
      console.error('Async prediction error:', error);
      coPredictedValue.textContent = 'Error';
      coPredictedValue.style.fontSize = '1.8vh';
      coPredictedValue.style.color = ''; // Reset color
    }
  });
}

// Standard BLE characteristic parsers
function parseTemperature(dataView) {
  // BLE Temperature characteristic is in 0.01 degrees Celsius
  return dataView.getInt16(0, true) / 100;
}

function parseHumidity(dataView) {
  // BLE Humidity characteristic is in 0.01 percent
  return dataView.getUint16(0, true) / 100;
}

function parsePressure(dataView) {
  // BLE Pressure characteristic is in 0.1 Pa, convert to hPa
  return dataView.getUint32(0, true) / 1000;
}

/**
 * Polling mode - read data periodically if notifications don't work
 */
function startPollingMode(deviceId) {
  console.log('Starting polling mode');
  monitoringInterval = setInterval(async () => {
    try {
      const value = await BleClient.read(deviceId, ESP32_SERVICE_UUID, ESP32_SENSOR_CHAR_UUID);
      parseSensorData(value);
    } catch (error) {
      console.error('Polling read error:', error);
    }
  }, 1000);
}

/**
 * Handle device disconnection
 */
function handleDisconnection() {
  isConnected = false;
  connectedDevice = null;
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.style.color = '#f44336';
  
  // Clear any intervals
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

/**
 * Demo mode - simulates sensor data for testing without ESP32
 */
function startDemoMode() {
  isConnected = true;
  connectionStatus.textContent = 'Demo Mode - Simulated Data';
  connectionStatus.style.color = '#ff9800';
  
  initializeGRUModel();
  
  monitoringInterval = setInterval(() => {
    const temp = 20 + Math.random() * 10;
    const humidity = 40 + Math.random() * 30;
    const pressure = 1000 + Math.random() * 30;
    const co = 2 + Math.random() * 8;
    
    updateSensorDisplay(temp, humidity, pressure, co);
  }, 1000);
}

/**
 * GRU Model for CO Level Forecasting
 * 
 * Model Architecture (from gru_co_forecasting_model.json):
 * - Input: [batch_size, 10, 4] - 10 time steps, 4 features (temp, humidity, pressure, co)
 * - GRU Layer: 50 units, tanh activation
 * - Dense Output: 1 unit (predicted CO level)
 */
async function initializeGRUModel() {
  modelStatus.textContent = '🔄 Loading GRU model...';
  modelStatus.className = 'model-status';
  
  try {
    // Set TensorFlow.js backend
    await tf.ready();
    console.log('TensorFlow.js backend:', tf.getBackend());
    
    // Load the pre-trained model with weights
    gruModel = await tf.loadLayersModel('./model.json');
    
    console.log('GRU Model loaded with weights:');
    gruModel.summary();
    
    gruModelLoaded = true;
    gruWeightsLoaded = true;
    modelStatus.textContent = '✅ GRU Model Ready';
    modelStatus.className = 'model-status ready';
    console.log('GRU model initialized with trained weights');
    
  } catch (error) {
    console.error('Failed to load GRU model:', error);
    
    // Fallback: Build model without weights
    try {
      console.log('Falling back to model without trained weights...');
      gruModel = tf.sequential();
      gruModel.add(tf.layers.gru({
        units: 50,
        inputShape: [10, 4],
        activation: 'tanh',
        recurrentActivation: 'sigmoid',
        returnSequences: false
      }));
      gruModel.add(tf.layers.dense({
        units: 1,
        activation: 'linear'
      }));
      
      gruModelLoaded = true;
      gruWeightsLoaded = false;
      modelStatus.textContent = '⚠️ Using fallback prediction';
      modelStatus.className = 'model-status';
      console.log('Using fallback model (no trained weights)');
    } catch (fallbackError) {
      console.error('Fallback model also failed:', fallbackError);
      modelStatus.textContent = '❌ Model failed to load';
      modelStatus.className = 'model-status error';
      gruModelLoaded = false;
      gruWeightsLoaded = false;
    }
  }
}

/**
 * Normalize sensor values to 0-1 range for model input
 */
function normalizeSensorData(temp, humidity, pressure, co) {
  return [
    (temp - NORM_PARAMS.temp.min) / (NORM_PARAMS.temp.max - NORM_PARAMS.temp.min),
    (humidity - NORM_PARAMS.humidity.min) / (NORM_PARAMS.humidity.max - NORM_PARAMS.humidity.min),
    (pressure - NORM_PARAMS.pressure.min) / (NORM_PARAMS.pressure.max - NORM_PARAMS.pressure.min),
    (co - NORM_PARAMS.co.min) / (NORM_PARAMS.co.max - NORM_PARAMS.co.min)
  ];
}

/**
 * Denormalize CO prediction back to original scale
 */
function denormalizeCO(normalizedCO) {
  return normalizedCO * (NORM_PARAMS.co.max - NORM_PARAMS.co.min) + NORM_PARAMS.co.min;
}

/**
 * Predict future CO level using GRU model or fallback method
 * @param {Array} history - Array of recent sensor readings [[temp, humidity, pressure, co], ...]
 * @returns {Promise<string|null>} Predicted CO level or null if not enough data
 */
async function predictCOLevel(history) {
  if (!gruModelLoaded || history.length < CO_HISTORY_SIZE) {
    return null;
  }
  
  // If trained weights are loaded, use the GRU model
  if (gruWeightsLoaded && gruModel) {
    try {
      // Get the last CO_HISTORY_SIZE readings
      const recentData = history.slice(-CO_HISTORY_SIZE);
      
      // Create input tensor with shape [1, 10, 4]
      const inputTensor = tf.tensor3d([recentData], [1, CO_HISTORY_SIZE, 4]);
      
      // Run prediction
      const prediction = gruModel.predict(inputTensor);
      
      // Get the predicted value asynchronously (non-blocking)
      const predictionData = await prediction.data();
      const predictedNormalized = predictionData[0];
      
      // Denormalize to get actual CO value
      const predictedCO = denormalizeCO(predictedNormalized);
      
      // Clean up tensors to prevent memory leaks
      inputTensor.dispose();
      prediction.dispose();
      
      // Clamp to reasonable range and return
      const clampedPrediction = Math.max(0, Math.min(100, predictedCO));
      return clampedPrediction.toFixed(1);
      
    } catch (error) {
      console.error('GRU Prediction error:', error);
      // Fall through to fallback prediction
    }
  }
  
  // Fallback: Use trend-based prediction when no trained weights
  return predictCOFallback();
}

/**
 * Fallback CO prediction using trend analysis
 * Uses exponential moving average and trend detection
 * @returns {string|null} Predicted CO level
 */
function predictCOFallback() {
  if (rawCOHistory.length < CO_HISTORY_SIZE) {
    return null;
  }
  
  const recentCO = rawCOHistory.slice(-CO_HISTORY_SIZE);
  
  // Calculate exponential moving average (more weight to recent values)
  const alpha = 0.3; // Smoothing factor
  let ema = recentCO[0];
  for (let i = 1; i < recentCO.length; i++) {
    ema = alpha * recentCO[i] + (1 - alpha) * ema;
  }
  
  // Calculate trend (linear regression slope)
  const n = recentCO.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recentCO[i];
    sumXY += i * recentCO[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  
  // Predict 5 steps ahead (matching "Next 5 min forecast")
  const stepsAhead = 5;
  const trendContribution = slope * stepsAhead;
  
  // Combine EMA with trend, applying dampening to avoid wild predictions
  const dampening = 0.7;
  const predicted = ema + (trendContribution * dampening);
  
  // Clamp to reasonable range
  const clampedPrediction = Math.max(0, Math.min(100, predicted));
  return clampedPrediction.toFixed(1);
}

/**
 * Update sensor history buffer with new reading
 * @param {number} temp - Temperature value
 * @param {number} humidity - Humidity value  
 * @param {number} pressure - Pressure value
 * @param {number} co - CO value
 */
function updateSensorHistory(temp, humidity, pressure, co) {
  // Normalize and add to history for GRU model
  const normalizedData = normalizeSensorData(temp, humidity, pressure, co);
  sensorHistory.push(normalizedData);
  
  // Also store raw CO for fallback prediction
  rawCOHistory.push(co);
  
  // Keep only the last CO_HISTORY_SIZE * 2 readings
  if (sensorHistory.length > CO_HISTORY_SIZE * 2) {
    sensorHistory = sensorHistory.slice(-CO_HISTORY_SIZE);
  }
  if (rawCOHistory.length > CO_HISTORY_SIZE * 2) {
    rawCOHistory = rawCOHistory.slice(-CO_HISTORY_SIZE);
  }
}

function startMonitoring() {
  // Monitoring will be started when a device is connected
  // The device picker handles the connection flow
  console.log('Monitor screen active');
}

async function stopMonitoring() {
  // Disconnect from ESP32 if connected
  if (connectedDevice) {
    try {
      await BleClient.disconnect(connectedDevice.deviceId);
      console.log('Disconnected from ESP32');
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  }
  
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  isConnected = false;
  connectedDevice = null;
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.style.color = 'rgba(255, 255, 255, 0.6)';
  
  // Reset values
  temperatureValue.textContent = '--';
  humidityValue.textContent = '--';
  coCurrentValue.textContent = '--';
  coPredictedValue.textContent = '--';
  coPredictedValue.style.fontSize = ''; // Reset font size
  
  // Reset sensor history and model status
  sensorHistory = [];
  rawCOHistory = [];
  gruModelLoaded = false;
  gruWeightsLoaded = false;
  gruModel = null;
  modelStatus.textContent = '🔄 Model loading...';
  modelStatus.className = 'model-status';
}

// Event listeners
connectBtn.addEventListener('click', () => {
  console.log('Connect button clicked');
  showDevicePicker();
});

escapeBtn.addEventListener('click', () => {
  console.log('Escape Route button clicked');
  goToEscape();
});

backBtn.addEventListener('click', () => {
  console.log('Back button clicked');
  goToHome();
});

escapeBackBtn.addEventListener('click', () => {
  console.log('Escape back button clicked');
  goToHome();
});

// =====================================================
// Escape Route Screen Functionality
// =====================================================

// Database and pathfinder instances
let coDatabase = null;
let pathFinder = null;
let currentPath = [];
let startPosition = { x: 0, y: 0 };

// Escape screen elements
const mapGrid = document.getElementById('map-grid');
const coTableBody = document.getElementById('co-table-body');
const resultsList = document.getElementById('results-list');
const startXInput = document.getElementById('start-x');
const startYInput = document.getElementById('start-y');

/**
 * Initialize the escape route screen
 */
function initializeEscapeScreen() {
  // Create database and pathfinder
  coDatabase = new CODatabase();
  pathFinder = new PathFinder(coDatabase);
  
  // Render initial map
  renderMap();
  
  // Render database table
  renderDatabaseTable();
  
  // Start real-time updates
  coDatabase.startRealTimeUpdates((locations) => {
    renderMap();
    renderDatabaseTable();
  });
  
  // Set up event listeners for controls
  setupEscapeControls();
  
  // Clear previous results
  resultsList.innerHTML = '<div class="no-path-message">Click "Find Safest Exit" to calculate routes</div>';
}

/**
 * Stop escape screen updates
 */
function stopEscapeScreen() {
  if (coDatabase) {
    coDatabase.stopRealTimeUpdates();
  }
  currentPath = [];
}

/**
 * Setup control event listeners
 */
function setupEscapeControls() {
  const findPathBtn = document.getElementById('find-path-btn');
  const setPositionBtn = document.getElementById('set-position-btn');
  const simulateBtn = document.getElementById('simulate-emergency-btn');
  const refreshDbBtn = document.getElementById('refresh-db-btn');
  
  findPathBtn.onclick = findSafestPath;
  setPositionBtn.onclick = setStartPosition;
  simulateBtn.onclick = simulateEmergency;
  refreshDbBtn.onclick = () => {
    renderDatabaseTable();
  };
}

/**
 * Set start position from inputs
 */
function setStartPosition() {
  const x = parseInt(startXInput.value) || 0;
  const y = parseInt(startYInput.value) || 0;
  
  // Validate position
  if (x >= 0 && x < 10 && y >= 0 && y < 10) {
    const location = coDatabase.getLocation(x, y);
    if (location && !location.isWall) {
      startPosition = { x, y };
      renderMap();
    } else {
      alert('Cannot set position on a wall!');
    }
  }
}

/**
 * Render the map grid
 */
function renderMap() {
  mapGrid.innerHTML = '';
  
  const locations = coDatabase.getAllLocations();
  
  locations.forEach(location => {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    cell.dataset.x = location.x;
    cell.dataset.y = location.y;
    
    // Determine cell class based on CO level and type
    if (location.isWall) {
      cell.classList.add('wall');
    } else if (location.isExit) {
      cell.classList.add('exit');
      cell.innerHTML = '<span class="cell-label">🚪</span>';
    } else {
      // Color based on CO level
      if (location.coLevel >= 50) {
        cell.classList.add('critical');
      } else if (location.coLevel >= 25) {
        cell.classList.add('dangerous');
      } else if (location.coLevel >= 15) {
        cell.classList.add('elevated');
      } else {
        cell.classList.add('safe');
      }
    }
    
    // Mark start position
    if (location.x === startPosition.x && location.y === startPosition.y) {
      cell.classList.add('start');
      cell.innerHTML = '<span class="cell-label">📍</span>';
    }
    
    // Mark path cells
    if (currentPath.some(p => p.x === location.x && p.y === location.y)) {
      cell.classList.add('path');
    }
    
    // Click to set as start
    cell.onclick = () => {
      if (!location.isWall) {
        startPosition = { x: location.x, y: location.y };
        startXInput.value = location.x;
        startYInput.value = location.y;
        renderMap();
      }
    };
    
    // Tooltip with CO level
    cell.title = location.isWall ? 'Wall' : 
                 location.isExit ? `Exit - CO: ${location.coLevel.toFixed(1)} ppm` :
                 `Zone ${location.id} - CO: ${location.coLevel.toFixed(1)} ppm`;
    
    mapGrid.appendChild(cell);
  });
}

/**
 * Render the CO database table
 */
function renderDatabaseTable() {
  const locations = coDatabase.getLocationsByCOLevel(false); // Sort by CO level descending
  
  coTableBody.innerHTML = '';
  
  // Show top 20 locations by CO level
  locations.slice(0, 20).forEach(location => {
    const row = document.createElement('tr');
    
    // Determine status
    let status, statusClass;
    if (location.coLevel >= 50) {
      status = 'CRITICAL';
      statusClass = 'critical';
    } else if (location.coLevel >= 25) {
      status = 'DANGEROUS';
      statusClass = 'dangerous';
    } else if (location.coLevel >= 15) {
      status = 'ELEVATED';
      statusClass = 'elevated';
    } else {
      status = 'SAFE';
      statusClass = 'safe';
    }
    
    row.innerHTML = `
      <td>Zone ${location.id} (${location.x},${location.y})</td>
      <td>${location.coLevel.toFixed(1)} ppm</td>
      <td><span class="status-badge ${statusClass}">${status}</span></td>
      <td>${formatTime(location.lastUpdated)}</td>
    `;
    
    coTableBody.appendChild(row);
  });
}

/**
 * Format time for display
 */
function formatTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return date.toLocaleTimeString();
}

/**
 * Find and display safest paths
 */
function findSafestPath() {
  const paths = pathFinder.findAlternativePaths(startPosition.x, startPosition.y, 9, 9, 3);
  
  if (paths.length === 0) {
    resultsList.innerHTML = '<div class="no-path-message">No safe paths found! All exits may be blocked.</div>';
    return;
  }
  
  resultsList.innerHTML = '';
  
  paths.forEach((result, index) => {
    const card = document.createElement('div');
    card.className = 'route-card' + (index === 0 ? ' recommended' : '');
    
    const avgCO = parseFloat(result.stats.averageCO);
    const maxCO = parseFloat(result.stats.maxCO);
    
    let avgClass = avgCO < 15 ? 'safe' : avgCO < 25 ? 'warning' : 'danger';
    let maxClass = maxCO < 25 ? 'safe' : maxCO < 50 ? 'warning' : 'danger';
    
    card.innerHTML = `
      <div class="route-header">
        <span class="route-name">${result.exitName || `Route ${index + 1}`}</span>
        ${index === 0 ? '<span class="route-badge">RECOMMENDED</span>' : ''}
      </div>
      <div class="route-stats">
        <div class="stat-item">
          <span class="stat-label">Distance</span>
          <span class="stat-value">${result.stats.length} zones</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg CO</span>
          <span class="stat-value ${avgClass}">${result.stats.averageCO} ppm</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Max CO</span>
          <span class="stat-value ${maxClass}">${result.stats.maxCO} ppm</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Est. Time</span>
          <span class="stat-value">${result.stats.estimatedTime}</span>
        </div>
      </div>
    `;
    
    // Click to show path on map
    card.onclick = () => {
      // Remove selected class from all cards
      document.querySelectorAll('.route-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      
      // Update current path and re-render map
      currentPath = result.path;
      renderMap();
    };
    
    resultsList.appendChild(card);
  });
  
  // Show the first (recommended) path by default
  if (paths.length > 0) {
    currentPath = paths[0].path;
    renderMap();
    document.querySelector('.route-card')?.classList.add('selected');
  }
}

/**
 * Simulate an emergency CO leak
 */
function simulateEmergency() {
  // Random leak source
  const sourceX = Math.floor(Math.random() * 8) + 1;
  const sourceY = Math.floor(Math.random() * 8) + 1;
  
  // Make sure it's not on a wall
  const location = coDatabase.getLocation(sourceX, sourceY);
  if (location && !location.isWall) {
    coDatabase.simulateCOSpread(sourceX, sourceY, 80);
    renderMap();
    renderDatabaseTable();
    
    // Show alert
    alert(`⚠️ CO LEAK DETECTED!\n\nSource: Zone at (${sourceX}, ${sourceY})\nCO Level: 80 ppm\n\nFinding safest escape route...`);
    
    // Automatically find path
    findSafestPath();
  } else {
    simulateEmergency(); // Try again
  }
}