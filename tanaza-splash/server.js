const express = require('express');
const mysql = require('mysql2/promise');
const app = express();
const port = 3000;

console.log('Starting server setup...');

app.use(express.static('public')); // Serve splash.html
app.use(express.json()); // Parse JSON bodies
console.log('Middleware configured.');

// MariaDB connection
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'tanaza_wifi',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

console.log('Database pool created.');

// Limits
const DATA_LIMIT = 1_000_000_000; // 1GB
const TIME_LIMIT = 3_600_000; // 1 hour

// Mock Tanaza API
const mockTanazaApi = async (endpoint, data) => {
  console.log(`Calling mockTanazaApi: ${endpoint}`);
  if (data) console.log('Payload:', data);

  if (endpoint === '/clients/auth') {
    return { data: { success: true, redirect_url: '/success' } };
  } else if (endpoint === '/clients/disconnect') {
    console.log(`Mock disconnect for ${data?.mac}`);
    return { data: { success: true } };
  } else if (endpoint.includes('/status')) {
    return { data: { success: true, status: 'connected' } };
  }

  console.warn('Unknown mockTanazaApi endpoint:', endpoint);
  throw new Error('Unknown endpoint');
};

// Authenticate API
app.post('/api/authenticate', async (req, res) => {
  console.log('Received authentication request.', req);
  console.log('Request body:', req.body);

 const { email, mac } = req.body;
if (!email || !mac) {
  console.warn('Missing email or MAC');
  return res.json({ success: false, message: 'Missing email or MAC' });
}

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE mac = ?', [mac]);
    const user = rows[0];
    console.log('User found in DB:', user);

    const today = new Date().toISOString().split('T')[0];
    console.log('Today is:', today);

    if (user && user.last_reset === today) {
      console.log('Checking limits...');
      if (user.data_used >= DATA_LIMIT) {
        console.warn('Data limit reached.');
        return res.json({ success: false, message: 'Data limit reached' });
      }
      if (user.time_used >= TIME_LIMIT) {
        console.warn('Time limit reached.');
        return res.json({ success: false, message: 'Time limit reached' });
      }
    } else {
      console.log('New day: resetting user usage.');
      await pool.query(
        'INSERT INTO users (mac, email, data_used, time_used, last_reset) VALUES (?, ?, 0, 0, ?) ON DUPLICATE KEY UPDATE email=?, data_used=0, time_used=0, last_reset=?',
        [mac, email, today, email, today]
      );
    }

    console.log('Calling mock API for device status...');
    const status = await mockTanazaApi('/status', {});
    console.log('Status response:', status);

    if (!status.data.success) {
      console.error('Device status check failed.');
      return res.json({ success: false, message: 'Device unavailable' });
    }

    console.log('Calling mock API for client auth...');
    const tanazaAuth = await mockTanazaApi('/clients/auth', { mac, email });
    console.log('Auth response:', tanazaAuth);

    if (tanazaAuth.data.success) {
      console.log(`Authentication successful. Redirecting ${mac}...`);
      updateUsage(mac); // Start tracking usage
      return res.json({ success: true, redirectUrl: tanazaAuth.data.redirect_url });
    } else {
      console.warn('Authentication failed.');
      return res.json({ success: false, message: 'Authentication failed' });
    }

  } catch (err) {
    console.log('Error during authentication:', err);
    return res.json({ success: false, message: 'Server error' });
  }
});

// Final redirect to Tanaza gateway
app.get('/success', (req, res) => {
  const { ap_ip, ap_port, client_mac, user_url } = req.query;
  console.log('Received /success parameters:', req.query);

//   if (!ap_ip || !ap_port || !client_mac || !user_url) {
//     console.log('Missing params in success:', req.query);
//     return res.status(400).send('<h1>Missing required parameters</h1>');
//   }

  console.log('Redirecting user to their original destination:', user_url);
  return res.redirect(user_url);
});


// Simulate usage tracking
async function updateUsage(mac) {
  console.log(`Starting usage tracking for MAC: ${mac}`);

  const interval = setInterval(async () => {
    try {
      const [rows] = await pool.query('SELECT * FROM users WHERE mac = ?', [mac]);
      const user = rows[0];
      if (!user) {
        console.warn(`MAC ${mac} not found during tracking. Stopping.`);
        return clearInterval(interval);
      }

      const newData = user.data_used + 100_000;
      const newTime = user.time_used + 1_000;

      console.log(`Updating usage for ${mac}: Data=${newData}, Time=${newTime}`);
      await pool.query('UPDATE users SET data_used=?, time_used=? WHERE mac=?', [newData, newTime, mac]);

      if (newData >= DATA_LIMIT || newTime >= TIME_LIMIT) {
        console.log(`Usage limit exceeded for ${mac}, disconnecting...`);
        await mockTanazaApi('/clients/disconnect', { mac });
        clearInterval(interval);
      }
    } catch (err) {
      console.error('Error during usage update:', err);
    }
  }, 1000);
}

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
