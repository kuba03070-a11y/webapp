const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// In-memory storage
const users = new Map();
const servers = new Map();
const messages = new Map();
const avatars = new Map();

// Create demo server
servers.set('demo', {
  id: 'demo',
  name: 'Demo Server',
  owner: 'admin',
  textChannels: [
    { 
      id: 'general', 
      name: 'General Chat',
      type: 'text',
      settings: {
        adminOnly: false,
        slowMode: 0,
        lastMessages: new Map()
      }
    },
    { 
      id: 'announcements', 
      name: 'Announcements',
      type: 'announcement',
      settings: {
        adminOnly: true,
        slowMode: 0
      }
    }
  ],
  voiceChannels: [
    { 
      id: 'voice1', 
      name: 'General Voice',
      type: 'voice',
      settings: {
        userLimit: 0,
        currentUsers: []
      }
    }
  ],
  members: [],
  invites: [],
  admins: ['admin']
});

// Middleware
app.use(express.static('public'));
app.use(express.json({limit: '5mb'}));

// Auth endpoints
app.post('/api/auth', async (req, res) => {
  const { username, password, action } = req.body;
  
  if (action === 'register') {
    if (users.has(username)) {
      return res.json({ success: false, message: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    users.set(username, { 
      username, 
      password: hashedPassword 
    });
    
    return res.json({ success: true, username });
  }
  
  if (action === 'login') {
    const user = users.get(username);
    if (!user) {
      return res.json({ success: false, message: 'User not found' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.json({ success: false, message: 'Invalid password' });
    }
    
    return res.json({ success: true, username });
  }
  
  res.json({ success: false, message: 'Invalid action' });
});

// Avatar endpoints
app.post('/api/avatar', (req, res) => {
  const { username, avatarData } = req.body;
  
  if (users.has(username)) {
    avatars.set(username, avatarData);
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'User not found' });
  }
});

app.get('/api/avatar/:username', (req, res) => {
  const avatarData = avatars.get(req.params.username);
  if (avatarData) {
    res.json({ success: true, avatar: avatarData });
  } else {
    res.json({ success: false });
  }
});

// Server endpoints
app.post('/api/server/create', (req, res) => {
  const { serverName, username } = req.body;
  
  if (!serverName || !username) {
    return res.json({ success: false, message: 'Missing data' });
  }
  
  const serverId = generateId();
  servers.set(serverId, {
    id: serverId,
    name: serverName,
    owner: username,
    textChannels: [
      { 
        id: 'general', 
        name: 'General Chat',
        type: 'text',
        settings: {
          adminOnly: false,
          slowMode: 0,
          lastMessages: new Map()
        }
      }
    ],
    voiceChannels: [
      { 
        id: 'voice1', 
        name: 'General Voice',
        type: 'voice',
        settings: {
          userLimit: 0,
          currentUsers: []
        }
      }
    ],
    members: [username],
    invites: [],
    admins: [username]
  });
  
  res.json({ success: true, serverId });
});

app.get('/api/server/:serverId', (req, res) => {
  const server = servers.get(req.params.serverId);
  if (!server) {
    return res.json({ success: false, message: 'Server not found' });
  }
  res.json({ success: true, server });
});

app.get('/api/server/:serverId/info', (req, res) => {
  const server = servers.get(req.params.serverId);
  if (!server) {
    return res.json({ success: false, message: 'Server not found' });
  }
  
  res.json({ 
    success: true, 
    server: {
      id: server.id,
      name: server.name,
      owner: server.owner,
      admins: server.admins,
      memberCount: server.members.length
    }
  });
});

// Channel endpoints
app.post('/api/server/:serverId/channel', (req, res) => {
  const serverId = req.params.serverId;
  const { channelName, channelType, username, settings } = req.body;
  
  const server = servers.get(serverId);
  if (!server) {
    return res.json({ success: false, message: 'Server not found' });
  }
  
  if (server.owner !== username && !server.admins.includes(username)) {
    return res.json({ success: false, message: 'Only server owners and admins can create channels' });
  }
  
  const channelId = generateId();
  
  let defaultSettings = {};
  if (channelType === 'text') {
    defaultSettings = { adminOnly: false, slowMode: 0 };
  } else if (channelType === 'announcement') {
    defaultSettings = { adminOnly: true, slowMode: 0 };
  } else if (channelType === 'voice') {
    defaultSettings = { userLimit: 0, currentUsers: [] };
  }
  
  const finalSettings = { ...defaultSettings, ...settings };
  
  const newChannel = {
    id: channelId,
    name: channelName,
    type: channelType,
    settings: finalSettings
  };
  
  if (channelType === 'text' || channelType === 'announcement') {
    server.textChannels.push(newChannel);
  } else if (channelType === 'voice') {
    server.voiceChannels.push(newChannel);
  }
  
  io.to(serverId).emit('channel-added', {
    channelType: channelType === 'voice' ? 'voice' : 'text',
    channel: newChannel
  });
  
  res.json({ success: true, channelId });
});

app.delete('/api/server/:serverId/channel/:channelId', (req, res) => {
  const { serverId, channelId } = req.params;
  const { username } = req.body;
  
  const server = servers.get(serverId);
  if (!server) {
    return res.json({ success: false, message: 'Server not found' });
  }
  
  if (server.owner !== username && !server.admins.includes(username)) {
    return res.json({ success: false, message: 'Only server owners and admins can delete channels' });
  }
  
  let channelRemoved = false;
  
  const textIndex = server.textChannels.findIndex(c => c.id === channelId);
  if (textIndex !== -1) {
    server.textChannels.splice(textIndex, 1);
    channelRemoved = true;
  }
  
  const voiceIndex = server.voiceChannels.findIndex(c => c.id === channelId);
  if (voiceIndex !== -1) {
    server.voiceChannels.splice(voiceIndex, 1);
    channelRemoved = true;
  }
  
  if (!channelRemoved) {
    return res.json({ success: false, message: 'Channel not found' });
  }
  
  io.to(serverId).emit('channel-removed', { channelId });
  
  res.json({ success: true });
});

// Invite endpoints
app.post('/api/server/:serverId/invite', (req, res) => {
  const serverId = req.params.serverId;
  const server = servers.get(serverId);
  
  if (!server) {
    return res.json({ success: false, message: 'Server not found' });
  }
  
  const inviteCode = generateInviteCode();
  server.invites.push({
    code: inviteCode,
    createdBy: req.body.username,
    createdAt: new Date(),
    uses: 0,
    maxUses: 10
  });
  
  res.json({ success: true, inviteCode });
});

app.post('/api/invite/:inviteCode', (req, res) => {
  const { inviteCode } = req.params;
  const { username } = req.body;
  
  let targetServer = null;
  let targetInvite = null;
  
  for (const [serverId, server] of servers.entries()) {
    const invite = server.invites.find(inv => inv.code === inviteCode);
    if (invite) {
      targetServer = server;
      targetInvite = invite;
      break;
    }
  }
  
  if (!targetServer || !targetInvite) {
    return res.json({ success: false, message: 'Invalid invite code' });
  }
  
  if (targetInvite.uses >= targetInvite.maxUses) {
    return res.json({ success: false, message: 'Invite has expired' });
  }
  
  if (targetServer.members.includes(username)) {
    return res.json({ success: false, message: 'Already in server' });
  }
  
  targetServer.members.push(username);
  targetInvite.uses++;
  
  res.json({ success: true, serverId: targetServer.id, serverName: targetServer.name });
});

// User servers
app.get('/api/user/:username/servers', (req, res) => {
  const username = req.params.username;
  const userServers = [];
  
  for (const [serverId, server] of servers.entries()) {
    if (server.members.includes(username)) {
      userServers.push({
        id: serverId,
        name: server.name,
        memberCount: server.members.length
      });
    }
  }
  
  res.json({ success: true, servers: userServers });
});

// Admin endpoints
app.post('/api/server/:serverId/admins', (req, res) => {
  const serverId = req.params.serverId;
  const { username, targetUser, action } = req.body;
  
  const server = servers.get(serverId);
  if (!server) {
    return res.json({ success: false, message: 'Server not found' });
  }
  
  if (server.owner !== username) {
    return res.json({ success: false, message: 'Only server owner can manage admins' });
  }
  
  if (action === 'add') {
    if (!server.admins.includes(targetUser)) {
      server.admins.push(targetUser);
    }
  } else if (action === 'remove') {
    const index = server.admins.indexOf(targetUser);
    if (index > -1 && targetUser !== server.owner) {
      server.admins.splice(index, 1);
    }
  }
  
  io.to(serverId).emit('admins-updated', { admins: server.admins });
  
  res.json({ success: true, admins: server.admins });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-server', ({ username, serverId }) => {
    const server = servers.get(serverId);
    if (server) {
      socket.join(serverId);
      socket.username = username;
      socket.serverId = serverId;
      
      if (!server.members.includes(username)) {
        server.members.push(username);
      }
      
      io.to(serverId).emit('user-list', server.members);
    }
  });
  
  socket.on('send-message', ({ channelId, message, username, serverId }) => {
    const server = servers.get(serverId);
    if (!server) return;
    
    const channel = server.textChannels.find(c => c.id === channelId);
    if (!channel) return;
    
    if (channel.settings.adminOnly && server.owner !== username && !server.admins.includes(username)) {
      socket.emit('message-error', { 
        channelId, 
        error: 'Only server owners and admins can send messages in this channel' 
      });
      return;
    }
    
    if (channel.settings.slowMode > 0) {
      const now = Date.now();
      const lastMessageTime = channel.settings.lastMessages.get(username) || 0;
      const cooldown = channel.settings.slowMode * 1000;
      
      if (now - lastMessageTime < cooldown) {
        const remaining = Math.ceil((cooldown - (now - lastMessageTime)) / 1000);
        socket.emit('message-error', { 
          channelId, 
          error: `Slow mode active. Please wait ${remaining} seconds before sending another message.` 
        });
        return;
      }
      
      channel.settings.lastMessages.set(username, now);
    }
    
    if (!messages.has(channelId)) {
      messages.set(channelId, []);
    }
    
    const msg = {
      id: Date.now(),
      username,
      text: message,
      timestamp: new Date().toLocaleTimeString(),
      isAdmin: server.admins.includes(username),
      isOwner: server.owner === username
    };
    
    messages.get(channelId).push(msg);
    
    io.to(serverId).emit('new-message', {
      channelId,
      message: msg
    });
  });
  
  socket.on('get-messages', ({ channelId }) => {
    const channelMessages = messages.get(channelId) || [];
    socket.emit('messages-history', {
      channelId,
      messages: channelMessages
    });
  });
  
  socket.on('signal', (data) => {
    socket.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal
    });
  });
  
  socket.on('join-voice', ({ channelId, serverId }) => {
    const server = servers.get(serverId);
    if (!server) return;
    
    const channel = server.voiceChannels.find(c => c.id === channelId);
    if (!channel) return;
    
    if (channel.settings.userLimit > 0 && 
        channel.settings.currentUsers.length >= channel.settings.userLimit) {
      socket.emit('voice-error', {
        channelId,
        error: 'Voice channel is full'
      });
      return;
    }
    
    if (!channel.settings.currentUsers.includes(socket.username)) {
      channel.settings.currentUsers.push(socket.username);
    }
    
    socket.voiceChannel = channelId;
    socket.join(`voice-${channelId}`);
    
    io.to(serverId).emit('voice-users-updated', {
      channelId,
      users: channel.settings.currentUsers
    });
  });
  
  socket.on('leave-voice', ({ channelId, serverId }) => {
    const server = servers.get(serverId);
    if (server) {
      const channel = server.voiceChannels.find(c => c.id === channelId);
      if (channel) {
        const index = channel.settings.currentUsers.indexOf(socket.username);
        if (index > -1) {
          channel.settings.currentUsers.splice(index, 1);
        }
        
        io.to(serverId).emit('voice-users-updated', {
          channelId,
          users: channel.settings.currentUsers
        });
      }
    }
    
    socket.leave(`voice-${channelId}`);
    socket.voiceChannel = null;
  });
  
  socket.on('avatar-changed', ({ username }) => {
    io.to(socket.serverId).emit('avatar-updated', { username });
  });
  
  socket.on('delete-channel', ({ serverId, channelId, channelType }) => {
    const server = servers.get(serverId);
    if (!server) return;
    
    if (server.owner !== socket.username && !server.admins.includes(socket.username)) {
      socket.emit('permission-error', { error: 'You do not have permission to delete channels' });
      return;
    }
    
    let channelRemoved = false;
    
    if (channelType === 'voice') {
      const index = server.voiceChannels.findIndex(c => c.id === channelId);
      if (index > -1) {
        server.voiceChannels.splice(index, 1);
        channelRemoved = true;
      }
    } else {
      const index = server.textChannels.findIndex(c => c.id === channelId);
      if (index > -1) {
        server.textChannels.splice(index, 1);
        channelRemoved = true;
      }
    }
    
    if (channelRemoved) {
      io.to(serverId).emit('channel-removed', { channelId });
    }
  });
  
  socket.on('update-channel-settings', ({ serverId, channelId, settings, channelType }) => {
    const server = servers.get(serverId);
    if (!server) return;
    
    if (server.owner !== socket.username && !server.admins.includes(socket.username)) {
      socket.emit('permission-error', { error: 'You do not have permission to modify channel settings' });
      return;
    }
    
    let channel = null;
    
    if (channelType === 'voice') {
      channel = server.voiceChannels.find(c => c.id === channelId);
    } else {
      channel = server.textChannels.find(c => c.id === channelId);
    }
    
    if (channel) {
      channel.settings = { ...channel.settings, ...settings };
      
      io.to(serverId).emit('channel-settings-updated', {
        channelId,
        settings: channel.settings
      });
    }
  });
  
  socket.on('disconnect', () => {
    if (socket.serverId && socket.username) {
      const server = servers.get(socket.serverId);
      if (server) {
        server.voiceChannels.forEach(channel => {
          const index = channel.settings.currentUsers.indexOf(socket.username);
          if (index > -1) {
            channel.settings.currentUsers.splice(index, 1);
          }
        });
        
        const memberIndex = server.members.indexOf(socket.username);
        if (memberIndex > -1) {
          server.members.splice(memberIndex, 1);
        }
        io.to(socket.serverId).emit('user-list', server.members);
      }
    }
  });
});

// Helper functions
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});