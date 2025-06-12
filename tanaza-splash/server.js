const express = require('express');
const mysql = require('mysql2/promise');
const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public')); // Serve splash.html from 'public' folder

// MariaDB connection
const pool = mysql.createPool({
  host: 'localhost',
  user: 'tanaza_user', // Replace with your MariaDB user
  password: 'your_password', // Replace with your MariaDB password
  database: 'tanaza_wifi',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Constants
const DATA_LIMIT = 1_000_000_000; // 1GB in bytes
const TIME_LIMIT = 3_600_000; // 1 hour in milliseconds

// Mock Tanaza API response for testing
const mockTanazaApi = async (endpoint, data) => {
    console.log('Data----', data);
    console.log('Endpoint----', endpoint);
    
    
  if (endpoint === '/apis/v3.0/11F975B0CFD3F548776B8C9C738605D1/A9E3F295D529FABA248B0790DAA30D9F/status') {
    return { data: { success: true, status: 'connected' } }; // Mock status check
  } else if (endpoint === '/clients/auth') {
    return { data: { success: true, redirect_url: 'http://localhost:3000/success' } }; // Mock auth
  } else if (endpoint === '/clients/disconnect') {
    return { data: { success: true } }; // Mock disconnect
  }
  throw new Error('Unknown endpoint');
};

// Authenticate user
app.post('/api/authenticate', async (req, res) => {
    console.log('Req-----', req);
    console.log('Res-----', res);
    
  const { email, mac } = req.body;
  if (!email || !mac) {
    return res.json({ success: false, message: 'Invalid request' });
  }

  try {
    // Check user limits
    const [rows] = await pool.query('SELECT * FROM users WHERE mac = ?', [mac]);
    const user = rows[0];
    const today = new Date().toISOString().split('T')[0];

    if (user && user.last_reset === today) {
      if (user.data_used >= DATA_LIMIT) {
        return res.json({ success: false, message: 'Daily data limit reached' });
      }
      if (user.time_used >= TIME_LIMIT) {
        return res.json({ success: false, message: 'Daily time limit reached' });
      }
    } else {
      // Reset usage for new day
      await pool.query(
        'INSERT INTO users (mac, email, data_used, time_used, last_reset) VALUES (?, ?, 0, 0, ?) ON DUPLICATE KEY UPDATE email = ?, data_used = 0, time_used = 0, last_reset = ?',
        [mac, email, today, email, today]
      );
    }

    // Simulate Tanaza API status check
    const statusResponse = await mockTanazaApi('/apis/v3.0/11F975B0CFD3F548776B8C9C738605D1/A9E3F295D529FABA248B0790DAA30D9F/status');
    if (!statusResponse.data.success) {
      return res.json({ success: false, message: 'Device not available' });
    }

    // Simulate Tanaza API authentication
    const tanazaResponse = await mockTanazaApi('/clients/auth', { mac, email, ssid: 'test_ssid' });

    if (tanazaResponse.data.success) {
      // Start tracking usage
      await updateUsage(mac);
      res.json({ success: true, redirectUrl: tanazaResponse.data.redirect_url });
    } else {
      res.json({ success: false, message: 'Authentication failed' });
    }
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Server error' });
  }
});

// Success page for testing
app.get('/success', (req, res) => {
  res.send('<h1>Connected Successfully!</h1><p>You are now connected to the WiFi.</p>');
});

// Update usage (simulate data/time tracking)
async function updateUsage(mac) {
  setInterval(async () => {
    try {
      const [rows] = await pool.query('SELECT * FROM users WHERE mac = ?', [mac]);
      const user = rows[0];
      if (!user) return;

      const newData = user.data_used + 100_000; // Simulate 100KB per second
      const newTime = user.time_used + 1_000; // Simulate 1 second

      await pool.query(
        'UPDATE users SET data_used = ?, time_used = ? WHERE mac = ?',
        [newData, newTime, mac]
      );

      if (newData >= DATA_LIMIT || newTime >= TIME_LIMIT) {
        // Simulate disconnection
        await mockTanazaApi('/clients/disconnect', { mac, ssid: 'test_ssid' });
        console.log(`User ${mac} disconnected due to limit`);
      }
    } catch (err) {
      console.error(err);
    }
  }, 1_000); // Update every second
}

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});