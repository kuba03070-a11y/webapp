const express = require('express');
const socketio = require('socket.io');
const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Database setup - SQLite for persistence
const db = new sqlite3.Database('./discord.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT '/uploads/default-avatar.png',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Servers table
  db.run(`CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    icon TEXT DEFAULT '/uploads/server-default.png',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users (id)
  )`);
  
  // Channels table (text or voice)
  db.run(`CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'text' CHECK(type IN ('text', 'voice')),
    server_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers (id)
  )`);
  
  // Messages table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (channel_id) REFERENCES channels (id)
  )`);
  
  // Server members table (many-to-many relationship)
  db.run(`CREATE TABLE IF NOT EXISTS server_members (
    server_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (server_id, user_id),
    FOREIGN KEY (server_id) REFERENCES servers (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);
  
  // Create default server and admin user if not exists
  db.get("SELECT COUNT(*) as count FROM users WHERE username = 'admin'", (err, row) => {
    if (row.count === 0) {
      const defaultPassword = bcrypt.hashSync('admin123', 10);
      db.run("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", 
        ['admin', 'admin@discord.com', defaultPassword], function(err) {
          if (err) console.error('Error creating admin:', err);
          
          // Create default server
          db.run("INSERT INTO servers (name, owner_id) VALUES (?, ?)", 
            ['General Server', this.lastID || 1], function(err) {
              if (err) console.error('Error creating default server:', err);
              
              const serverId = this.lastID || 1;
              
              // Create default channels
              db.run("INSERT INTO channels (name, type, server_id) VALUES (?, ?, ?)", 
                ['general', 'text', serverId]);
              db.run("INSERT INTO channels (name, type, server_id) VALUES (?, ?, ?)", 
                ['voice-chat', 'voice', serverId]);
              db.run("INSERT INTO channels (name, type, server_id) VALUES (?, ?, ?)", 
                ['gaming', 'text', serverId]);
              
              // Add admin as member of default server
              db.run("INSERT INTO server_members (server_id, user_id) VALUES (?, ?)", 
                [serverId, 1]);
              
              console.log('✅ Created default admin user and server');
            });
        });
    }
  });
});

// File upload configuration for profile pictures
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'public/uploads/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));

// Create default avatar if doesn't exist
const defaultAvatarPath = 'public/uploads/default-avatar.png';
if (!fs.existsSync(defaultAvatarPath)) {
  // Create a simple SVG as default avatar
  const defaultAvatar = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <circle cx="50" cy="35" r="20" fill="#7289da"/>
    <circle cx="50" cy="100" r="45" fill="#7289da"/>
  </svg>`;
  fs.writeFileSync(defaultAvatarPath.replace('.png', '.svg'), defaultAvatar);
}

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ==================== API ROUTES ====================

// User registration
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  try {
    // Check if user exists
    db.get("SELECT id FROM users WHERE username = ? OR email = ?", [username, email], async (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (row) return res.status(400).json({ error: 'Username or email already exists' });
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      
      db.run("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", 
        [username, email, hashedPassword], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          
          res.status(201).json({ 
            id: this.lastID, 
            username, 
            email,
            avatar: '/uploads/default-avatar.png'
          });
        });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// User login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    // Compare passwords
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
    
    // Remove password from response
    delete user.password;
    res.json(user);
  });
});

// Get all servers for a user
app.get('/api/users/:userId/servers', (req, res) => {
  const userId = req.params.userId;
  
  db.all(`
    SELECT s.* 
    FROM servers s
    LEFT JOIN server_members sm ON s.id = sm.server_id
    WHERE s.owner_id = ? OR sm.user_id = ?
    GROUP BY s.id
  `, [userId, userId], (err, servers) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(servers);
  });
});

// Create new server
app.post('/api/servers', (req, res) => {
  const { name, owner_id } = req.body;
  
  db.run("INSERT INTO servers (name, owner_id) VALUES (?, ?)", 
    [name, owner_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      const serverId = this.lastID;
      
      // Add owner as member
      db.run("INSERT INTO server_members (server_id, user_id) VALUES (?, ?)", 
        [serverId, owner_id]);
      
      // Create default channels for the new server
      db.run("INSERT INTO channels (name, type, server_id) VALUES (?, ?, ?)", 
        ['general', 'text', serverId]);
      db.run("INSERT INTO channels (name, type, server_id) VALUES (?, ?, ?)", 
        ['voice-chat', 'voice', serverId]);
      
      res.status(201).json({ 
        id: serverId, 
        name, 
        owner_id,
        icon: '/uploads/server-default.png'
      });
    });
});

// Get server channels
app.get('/api/servers/:serverId/channels', (req, res) => {
  const serverId = req.params.serverId;
  
  db.all("SELECT * FROM channels WHERE server_id = ? ORDER BY type, name", 
    [serverId], (err, channels) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(channels);
    });
});

// Create new channel
app.post('/api/channels', (req, res) => {
  const { name, type, server_id } = req.body;
  
  db.run("INSERT INTO channels (name, type, server_id) VALUES (?, ?, ?)", 
    [name, type, server_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, name, type, server_id });
    });
});

// Get channel messages
app.get('/api/channels/:channelId/messages', (req, res) => {
  const channelId = req.params.channelId;
  const limit = req.query.limit || 50;
  
  db.all(`
    SELECT m.*, u.username, u.avatar 
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.channel_id = ?
    ORDER BY m.created_at ASC
    LIMIT ?
  `, [channelId, limit], (err, messages) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(messages);
  });
});

// Send message
app.post('/api/messages', (req, res) => {
  const { content, user_id, channel_id } = req.body;
  
  if (!content || !user_id || !channel_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  db.run("INSERT INTO messages (content, user_id, channel_id) VALUES (?, ?, ?)", 
    [content, user_id, channel_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // Get the newly created message with user info
      db.get(`
        SELECT m.*, u.username, u.avatar 
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.id = ?
      `, [this.lastID], (err, message) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Broadcast to all clients in the channel
        io.to(`channel_${channel_id}`).emit('new_message', message);
        res.status(201).json(message);
      });
    });
});

// Upload profile picture
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const userId = req.body.user_id;
  const avatarPath = `/uploads/${req.file.filename}`;
  
  db.run("UPDATE users SET avatar = ? WHERE id = ?", 
    [avatarPath, userId], function(err) {
      if (err) {
        // Delete the uploaded file if database update fails
        fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: err.message });
      }
      
      // Get updated user info
      db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        delete user.password;
        
        // Broadcast avatar update to all relevant clients
        io.emit('avatar_updated', { user_id: userId, avatar: avatarPath });
        res.json({ avatar: avatarPath, user });
      });
    });
});

// Get user by ID
app.get('/api/users/:userId', (req, res) => {
  const userId = req.params.userId;
  
  db.get("SELECT id, username, email, avatar, created_at FROM users WHERE id = ?", 
    [userId], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    });
});

// Search users
app.get('/api/users/search/:query', (req, res) => {
  const query = `%${req.params.query}%`;
  
  db.all(`
    SELECT id, username, avatar 
    FROM users 
    WHERE username LIKE ? 
    LIMIT 10
  `, [query], (err, users) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(users);
  });
});

// ==================== SOCKET.IO HANDLING ====================

// Track voice channel users
const voiceRooms = new Map(); // channelId -> Set of socketIds

io.on('connection', (socket) => {
  console.log('🔗 New client connected:', socket.id);
  
  // Join text channel room
  socket.on('join_channel', (data) => {
    socket.join(`channel_${data.channel_id}`);
    socket.join(`server_${data.server_id}`);
    console.log(`User joined channel ${data.channel_id} on server ${data.server_id}`);
  });
  
  socket.on('leave_channel', (data) => {
    socket.leave(`channel_${data.channel_id}`);
  });
  
  // ==================== VOICE CHAT FUNCTIONALITY ====================
  
  // Join voice channel
  socket.on('join_voice', (data) => {
    const { channelId, userId, username, avatar } = data;
    
    console.log(`🔊 User ${username} joining voice channel ${channelId}`);
    
    // Join the voice room
    socket.join(`voice_${channelId}`);
    socket.voiceChannel = channelId;
    
    // Add to voice room tracking
    if (!voiceRooms.has(channelId)) {
      voiceRooms.set(channelId, new Set());
    }
    voiceRooms.get(channelId).add(socket.id);
    
    // Get all users in this voice channel
    const usersInRoom = Array.from(voiceRooms.get(channelId) || [])
      .filter(sid => sid !== socket.id)
      .map(sid => ({
        socketId: sid,
        userId: io.sockets.sockets.get(sid)?.userId,
        username: io.sockets.sockets.get(sid)?.username
      }));
    
    // Notify the new user about existing users
    socket.emit('voice_users_list', usersInRoom);
    
    // Notify others about the new user
    socket.to(`voice_${channelId}`).emit('user_joined_voice', {
      socketId: socket.id,
      userId,
      username,
      avatar
    });
    
    // Store user info on socket
    socket.userId = userId;
    socket.username = username;
  });
  
  // WebRTC signaling: Offer
  socket.on('offer', (data) => {
    console.log(`📞 Offer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id,
      cameraEnabled: data.cameraEnabled || false
    });
  });
  
  // WebRTC signaling: Answer
  socket.on('answer', (data) => {
    console.log(`📞 Answer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });
  
  // WebRTC signaling: ICE Candidate
  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });
  
  // Toggle camera
  socket.on('toggle_camera', (data) => {
    const { channelId, enabled } = data;
    console.log(`📹 User ${socket.username} toggled camera: ${enabled}`);
    
    socket.to(`voice_${channelId}`).emit('camera_toggled', {
      socketId: socket.id,
      enabled
    });
  });
  
  // Toggle microphone
  socket.on('toggle_microphone', (data) => {
    const { channelId, enabled } = data;
    socket.to(`voice_${channelId}`).emit('microphone_toggled', {
      socketId: socket.id,
      enabled
    });
  });
  
  // Leave voice channel
  socket.on('leave_voice', (data) => {
    const { channelId } = data;
    
    console.log(`🔇 User ${socket.username} leaving voice channel ${channelId}`);
    
    // Remove from voice room tracking
    if (voiceRooms.has(channelId)) {
      voiceRooms.get(channelId).delete(socket.id);
      if (voiceRooms.get(channelId).size === 0) {
        voiceRooms.delete(channelId);
      }
    }
    
    // Leave the room
    socket.leave(`voice_${channelId}`);
    delete socket.voiceChannel;
    
    // Notify others
    socket.to(`voice_${channelId}`).emit('user_left_voice', {
      socketId: socket.id,
      userId: socket.userId
    });
  });
  
  // Typing indicator
  socket.on('typing_start', (data) => {
    const { channelId, userId, username } = data;
    socket.to(`channel_${channelId}`).emit('user_typing', {
      userId,
      username,
      typing: true
    });
  });
  
  socket.on('typing_stop', (data) => {
    const { channelId, userId } = data;
    socket.to(`channel_${channelId}`).emit('user_typing', {
      userId,
      typing: false
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    
    // Handle voice channel cleanup on disconnect
    if (socket.voiceChannel) {
      const channelId = socket.voiceChannel;
      
      // Remove from voice room tracking
      if (voiceRooms.has(channelId)) {
        voiceRooms.get(channelId).delete(socket.id);
        if (voiceRooms.get(channelId).size === 0) {
          voiceRooms.delete(channelId);
        }
      }
      
      // Notify others in the voice channel
      socket.to(`voice_${channelId}`).emit('user_left_voice', {
        socketId: socket.id,
        userId: socket.userId
      });
    }
  });
});

// ==================== HELPER FUNCTIONS ====================

// Backup database periodically (every hour)
setInterval(() => {
  const backupPath = `backup/discord-${Date.now()}.db`;
  
  if (!fs.existsSync('backup')) {
    fs.mkdirSync('backup', { recursive: true });
  }
  
  fs.copyFile('./discord.db', backupPath, (err) => {
    if (err) {
      console.error('Backup failed:', err);
    } else {
      console.log(`✅ Database backed up to ${backupPath}`);
      
      // Keep only last 24 backups
      fs.readdir('backup', (err, files) => {
        if (files && files.length > 24) {
          files.sort().slice(0, files.length - 24).forEach(file => {
            fs.unlinkSync(`backup/${file}`);
          });
        }
      });
    }
  });
}, 3600000); // 1 hour

// ==================== SERVER START ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
🚀 Discord Clone Server Started!
📡 Server running on: http://localhost:${PORT}
💾 Database: discord.db (SQLite)
📁 Uploads: public/uploads/
  
✅ Fixed Issues:
  1. ✅ Data Persistence - All data saved in SQLite database
  2. ✅ Multiple Servers - Users can create unlimited servers
  3. ✅ Profile Pictures - Upload and display avatars
  4. ✅ Voice Channels - WebRTC with proper signaling
  5. ✅ Camera Support - Toggle camera on voice channels
  6. ✅ Chat History - Messages persist after restart
  
👤 Default Admin Credentials:
   Username: admin
   Password: admin123
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  
  // Close database connection
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('✅ Database connection closed');
    }
    
    // Close server
    server.close(() => {
      console.log('✅ Server stopped');
      process.exit(0);
    });
  });
});
