// Global variables
let socket;
let currentUser = '';
let currentServer = 'demo';
let currentChannel = 'general';
let currentVoiceChannel = null;
let peers = {};
let stream = null;
let userAvatar = null;
let avatarFile = null;
let userServers = [];
let currentServerInfo = null;
let isServerOwner = false;
let isServerAdmin = false;
let currentEditingChannel = null;
let currentEditingChannelType = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const authMessage = document.getElementById('auth-message');
const logoutBtn = document.getElementById('logout-btn');
const currentUsername = document.getElementById('current-username');
const serverName = document.getElementById('server-name');
const textChannels = document.getElementById('text-channels');
const voiceChannels = document.getElementById('voice-channels');
const currentChannelElem = document.getElementById('current-channel');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const onlineCount = document.getElementById('online-count');
const voiceContainer = document.getElementById('voice-container');
const voiceUsers = document.getElementById('voice-users');
const muteBtn = document.getElementById('mute-btn');
const leaveVoiceBtn = document.getElementById('leave-voice-btn');

// Authentication
loginBtn.addEventListener('click', () => handleAuth('login'));
registerBtn.addEventListener('click', () => handleAuth('register'));

async function handleAuth(action) {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!username || !password) {
        showAuthMessage('Please fill in all fields', 'error');
        return;
    }
    
    const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, action })
    });
    
    const data = await response.json();
    
    if (data.success) {
        currentUser = username;
        currentUsername.textContent = username;
        loginScreen.style.display = 'none';
        app.style.display = 'flex';
        initializeSocket();
        loadServer('demo');
    } else {
        showAuthMessage(data.message, 'error');
    }
}

function showAuthMessage(message, type) {
    authMessage.textContent = message;
    authMessage.style.color = type === 'error' ? '#f04747' : '#43b581';
}

// Socket.io
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
        socket.username = currentUser;
        socket.serverId = currentServer;
        
        socket.emit('join-server', {
            username: currentUser,
            serverId: currentServer
        });
        
        loadUserAvatar();
        loadUserServers();
        loadServerInfo(currentServer);
    });
    
    socket.on('user-list', (users) => {
        onlineCount.textContent = users.length;
        updateOnlineUsers(users);
    });
    
    socket.on('new-message', ({ channelId, message }) => {
        if (channelId === currentChannel) {
            addMessage(message);
        }
    });
    
    socket.on('messages-history', ({ channelId, messages }) => {
        if (channelId === currentChannel) {
            messagesContainer.innerHTML = '';
            messages.forEach(msg => addMessage(msg));
        }
    });
    
    socket.on('channel-added', ({ channelType, channel }) => {
        if (channelType === 'voice') {
            addChannelElement(channel, 'voice-channels');
        } else {
            addChannelElement(channel, 'text-channels');
        }
    });
    
    socket.on('channel-removed', ({ channelId }) => {
        const channelElem = document.querySelector(`.channel[data-channel-id="${channelId}"]`);
        if (channelElem) {
            channelElem.remove();
        }
        
        if (channelId === currentChannel) {
            const firstChannel = document.querySelector('.channel.text, .channel.announcement');
            if (firstChannel) {
                switchChannel(firstChannel.dataset.channelId, firstChannel.dataset.channelType);
            }
        }
    });
    
    socket.on('channel-settings-updated', ({ channelId, settings }) => {
        const channelElem = document.querySelector(`.channel[data-channel-id="${channelId}"]`);
        if (channelElem) {
            updateChannelStatus(channelElem, settings);
        }
    });
    
    socket.on('admins-updated', ({ admins }) => {
        if (currentServerInfo) {
            currentServerInfo.admins = admins;
            isServerAdmin = admins.includes(currentUser);
            updatePermissionsUI();
        }
    });
    
    socket.on('voice-users-updated', ({ channelId, users }) => {
        if (channelId === currentVoiceChannel) {
            updateVoiceUsers(users);
        }
    });
    
    socket.on('message-error', ({ channelId, error }) => {
        if (channelId === currentChannel) {
            alert(error);
        }
    });
    
    socket.on('voice-error', ({ channelId, error }) => {
        alert(error);
    });
    
    socket.on('permission-error', ({ error }) => {
        alert(error);
    });
    
    socket.on('avatar-updated', ({ username }) => {
        if (username === currentUser) {
            loadUserAvatar();
        }
    });
    
    socket.on('signal', handleSignal);
}

function handleSignal(data) {
    if (!peers[data.from]) {
        const peer = new SimplePeer({
            initiator: false,
            stream: stream,
            trickle: false
        });
        
        peer.on('signal', signal => {
            socket.emit('signal', {
                to: data.from,
                signal: signal
            });
        });
        
        peer.on('stream', remoteStream => {
            // Handle remote stream
        });
        
        peer.signal(data.signal);
        peers[data.from] = peer;
    }
}

// Server and Channel Management
async function loadUserServers() {
    try {
        const response = await fetch(`/api/user/${currentUser}/servers`);
        const data = await response.json();
        
        if (data.success) {
            userServers = data.servers;
            renderServerList();
        }
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

function renderServerList() {
    const serverList = document.getElementById('server-list');
    serverList.innerHTML = '';
    
    userServers.forEach(server => {
        const serverElem = document.createElement('div');
        serverElem.className = `server ${server.id === currentServer ? 'active' : ''}`;
        serverElem.dataset.server = server.id;
        
        const serverIcon = server.name.charAt(0).toUpperCase();
        const colors = ['#7289da', '#f04747', '#43b581', '#faa61a', '#9b59b6'];
        const hash = server.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const color = colors[hash % colors.length];
        
        serverElem.innerHTML = `
            <div class="server-icon" style="background:${color};width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;border-radius:${server.id === currentServer ? '30%' : '50%'};transition:all 0.3s;">
                ${serverIcon}
            </div>
        `;
        
        const menuTemplate = document.getElementById('server-menu-template').content.cloneNode(true);
        serverElem.appendChild(menuTemplate);
        
        serverElem.addEventListener('click', (e) => {
            if (!e.target.closest('.server-menu')) {
                switchServer(server.id);
            }
        });
        
        serverList.appendChild(serverElem);
    });
    
    const addServerBtn = document.createElement('div');
    addServerBtn.className = 'add-server';
    addServerBtn.innerHTML = '<i class="fas fa-plus"></i>';
    addServerBtn.addEventListener('click', showCreateServerModal);
    serverList.appendChild(addServerBtn);
}

function switchServer(serverId) {
    currentServer = serverId;
    currentChannel = 'general';
    
    document.querySelectorAll('.server').forEach(s => s.classList.remove('active'));
    document.querySelector(`.server[data-server="${serverId}"]`)?.classList.add('active');
    
    socket.emit('join-server', {
        username: currentUser,
        serverId: serverId
    });
    
    loadServer(serverId);
    loadServerInfo(serverId);
}

async function loadServer(serverId) {
    try {
        const response = await fetch(`/api/server/${serverId}`);
        const data = await response.json();
        
        if (data.success) {
            const server = data.server;
            serverName.textContent = server.name;
            
            textChannels.innerHTML = '';
            voiceChannels.innerHTML = '';
            
            server.textChannels.forEach(channel => {
                addChannelElement(channel, 'text-channels');
            });
            
            server.voiceChannels.forEach(channel => {
                addChannelElement(channel, 'voice-channels');
            });
            
            if (!server.textChannels.find(c => c.id === currentChannel) && server.textChannels.length > 0) {
                currentChannel = server.textChannels[0].id;
            }
            
            currentChannelElem.textContent = currentChannel;
            socket.emit('get-messages', { channelId: currentChannel });
        }
    } catch (error) {
        console.error('Error loading server:', error);
    }
}

async function loadServerInfo(serverId) {
    try {
        const response = await fetch(`/api/server/${serverId}/info`);
        const data = await response.json();
        
        if (data.success) {
            currentServerInfo = data.server;
            isServerOwner = currentServerInfo.owner === currentUser;
            isServerAdmin = currentServerInfo.admins.includes(currentUser);
            updatePermissionsUI();
        }
    } catch (error) {
        console.error('Error loading server info:', error);
    }
}

function updatePermissionsUI() {
    const addChannelButtons = document.querySelectorAll('.add-channel-btn');
    addChannelButtons.forEach(btn => {
        btn.style.display = (isServerOwner || isServerAdmin) ? 'block' : 'none';
    });
    
    const serverName = document.getElementById('server-name');
    if (isServerOwner) {
        if (!serverName.innerHTML.includes('owner-crown')) {
            serverName.innerHTML += ' <i class="fas fa-crown owner-crown" title="Server Owner"></i>';
        }
    }
}

function addChannelElement(channel, containerId) {
    const channelElem = document.createElement('div');
    channelElem.className = `channel ${channel.type} ${channel.id === currentChannel ? 'active' : ''}`;
    channelElem.dataset.channelId = channel.id;
    channelElem.dataset.channelType = channel.type;
    
    let icon = 'fa-hashtag';
    if (channel.type === 'announcement') {
        icon = 'fa-bullhorn';
    } else if (channel.type === 'voice') {
        icon = 'fa-volume-up';
    }
    
    let status = '';
    if (channel.type === 'voice') {
        const current = channel.settings.currentUsers?.length || 0;
        const limit = channel.settings.userLimit || 0;
        status = `<span class="voice-status ${limit > 0 && current >= limit ? 'full' : ''}">
            ${current}${limit > 0 ? `/${limit}` : ''}
        </span>`;
    } else {
        if (channel.settings.adminOnly) {
            status = ' <span class="admin-badge">Admin</span>';
        }
        if (channel.settings.slowMode > 0) {
            status += ` <span class="slow-mode-indicator">${channel.settings.slowMode}s</span>`;
        }
    }
    
    channelElem.innerHTML = `
        <i class="fas ${icon}"></i> ${channel.name}${status}
    `;
    
    if (isServerOwner || isServerAdmin) {
        const menuTemplate = document.getElementById('channel-context-menu-template').content.cloneNode(true);
        channelElem.appendChild(menuTemplate);
    }
    
    if (channel.type === 'voice') {
        channelElem.addEventListener('click', () => joinVoiceChannel(channel.id));
    } else {
        channelElem.addEventListener('click', () => switchChannel(channel.id, channel.type));
    }
    
    document.getElementById(containerId).appendChild(channelElem);
}

function switchChannel(channelId, channelType) {
    currentChannel = channelId;
    currentChannelElem.textContent = channelId;
    
    document.querySelectorAll('.channel').forEach(c => c.classList.remove('active'));
    document.querySelector(`.channel[data-channel-id="${channelId}"]`)?.classList.add('active');
    
    socket.emit('get-messages', { channelId });
}

function updateChannelStatus(channelElem, settings) {
    let status = '';
    
    if (channelElem.dataset.channelType === 'voice') {
        const current = settings.currentUsers?.length || 0;
        const limit = settings.userLimit || 0;
        status = `<span class="voice-status ${limit > 0 && current >= limit ? 'full' : ''}">
            ${current}${limit > 0 ? `/${limit}` : ''}
        </span>`;
    } else {
        if (settings.adminOnly) {
            status = ' <span class="admin-badge">Admin</span>';
        }
        if (settings.slowMode > 0) {
            status += ` <span class="slow-mode-indicator">${settings.slowMode}s</span>`;
        }
    }
    
    const channelName = channelElem.textContent.split('<')[0].trim();
    const icon = channelElem.querySelector('i').outerHTML;
    channelElem.innerHTML = `${icon} ${channelName}${status}`;
    
    if (isServerOwner || isServerAdmin) {
        const menuTemplate = document.getElementById('channel-context-menu-template').content.cloneNode(true);
        channelElem.appendChild(menuTemplate);
    }
}

// Messaging
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;
    
    socket.emit('send-message', {
        channelId: currentChannel,
        message,
        username: currentUser,
        serverId: currentServer
    });
    
    messageInput.value = '';
}

function addMessage(message) {
    const messageElem = document.createElement('div');
    messageElem.className = 'message';
    
    let avatarHTML = getAvatarHTML(message.username);
    let ownerBadge = message.isOwner ? '<span class="owner-badge">Owner</span>' : '';
    let adminBadge = !message.isOwner && message.isAdmin ? '<span class="admin-badge">Admin</span>' : '';
    
    messageElem.innerHTML = `
        <div class="message-avatar" data-username="${message.username}">
            ${avatarHTML}
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">
                    <span class="author-name">${message.username}</span>
                    ${ownerBadge}
                    ${adminBadge}
                </span>
                <span class="message-time">${message.timestamp}</span>
            </div>
            <div class="message-text">${message.text}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageElem);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function getAvatarHTML(username) {
    const colors = ['#7289da', '#f04747', '#43b581', '#faa61a', '#9b59b6'];
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const color = colors[hash % colors.length];
    const initial = username.charAt(0).toUpperCase();
    
    return `<div class="avatar-fallback" style="background:${color};width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-size:18px;font-weight:bold;">${initial}</div>`;
}

// Avatar Management
async function loadUserAvatar() {
    try {
        const response = await fetch(`/api/avatar/${currentUser}`);
        const data = await response.json();
        
        if (data.success && data.avatar) {
            userAvatar = data.avatar;
            updateAvatarUI();
        } else {
            generateDefaultAvatar();
        }
    } catch (error) {
        console.error('Error loading avatar:', error);
        generateDefaultAvatar();
    }
}

function generateDefaultAvatar() {
    const colors = ['avatar-default-blue', 'avatar-default-red', 'avatar-default-green', 
                   'avatar-default-yellow', 'avatar-default-purple'];
    const hash = currentUser.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colorClass = colors[hash % colors.length];
    
    userAvatar = {
        type: 'default',
        color: colorClass,
        initial: currentUser.charAt(0).toUpperCase()
    };
    
    updateAvatarUI();
}

function updateAvatarUI() {
    const avatarPreview = document.getElementById('avatar-preview');
    const avatarFallback = document.getElementById('avatar-fallback');
    const userAvatarSmall = document.getElementById('user-avatar-small');
    const userAvatarFallback = document.getElementById('user-avatar-fallback');
    
    if (userAvatar && userAvatar.type === 'image') {
        avatarPreview.innerHTML = `<img src="${userAvatar.data}" alt="Avatar">`;
        userAvatarSmall.innerHTML = `<img src="${userAvatar.data}" alt="Avatar">`;
    } else {
        avatarPreview.className = `avatar-preview ${userAvatar.color}`;
        avatarFallback.textContent = userAvatar.initial;
        avatarPreview.innerHTML = `<div class="${userAvatar.color}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-size:48px;font-weight:bold;">${userAvatar.initial}</div>`;
        
        userAvatarSmall.className = `user-avatar-small ${userAvatar.color}`;
        userAvatarFallback.textContent = userAvatar.initial;
        userAvatarSmall.innerHTML = `<div class="${userAvatar.color}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-size:18px;font-weight:bold;">${userAvatar.initial}</div>`;
    }
}

document.getElementById('edit-profile-btn').addEventListener('click', showAvatarModal);
document.getElementById('user-avatar-small').addEventListener('click', showAvatarModal);
document.getElementById('avatar-file-input').addEventListener('change', handleAvatarUpload);
document.getElementById('save-avatar-btn').addEventListener('click', saveAvatar);
document.getElementById('cancel-avatar-btn').addEventListener('click', hideAvatarModal);

function showAvatarModal() {
    document.getElementById('avatar-modal').style.display = 'flex';
}

function hideAvatarModal() {
    document.getElementById('avatar-modal').style.display = 'none';
    avatarFile = null;
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.size > 1024 * 1024) {
        alert('File size must be less than 1MB');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = 256;
            canvas.height = 256;
            
            const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
            const x = (canvas.width / 2) - (img.width / 2) * scale;
            const y = (canvas.height / 2) - (img.height / 2) * scale;
            
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
            
            const dataURL = canvas.toDataURL('image/jpeg', 0.8);
            
            const preview = document.getElementById('avatar-preview');
            preview.innerHTML = `<img src="${dataURL}" alt="Avatar preview">`;
            
            avatarFile = {
                type: 'image',
                data: dataURL
            };
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function saveAvatar() {
    if (!avatarFile) {
        alert('Please select an image first');
        return;
    }
    
    try {
        const response = await fetch('/api/avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentUser,
                avatarData: avatarFile
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            userAvatar = avatarFile;
            updateAvatarUI();
            hideAvatarModal();
            
            socket.emit('avatar-changed', { username: currentUser });
        } else {
            alert('Failed to save avatar');
        }
    } catch (error) {
        console.error('Error saving avatar:', error);
        alert('Error saving avatar');
    }
}

// Modals
document.getElementById('create-server-action').addEventListener('click', showCreateServerModal);
document.getElementById('join-server-action').addEventListener('click', showJoinServerModal);
document.getElementById('create-server-btn').addEventListener('click', createServer);
document.getElementById('cancel-create-server-btn').addEventListener('click', hideCreateServerModal);
document.getElementById('create-channel-btn').addEventListener('click', createChannel);
document.getElementById('cancel-create-channel-btn').addEventListener('click', hideCreateChannelModal);
document.getElementById('copy-invite-btn').addEventListener('click', copyInviteCode);
document.getElementById('close-invite-btn').addEventListener('click', hideInviteModal);
document.getElementById('join-server-btn').addEventListener('click', joinServer);
document.getElementById('cancel-join-server-btn').addEventListener('click', hideJoinServerModal);
document.getElementById('save-channel-settings').addEventListener('click', saveChannelSettings);
document.getElementById('cancel-channel-settings').addEventListener('click', hideChannelSettingsModal);
document.getElementById('add-admin-btn').addEventListener('click', addAdmin);
document.getElementById('close-admin-modal').addEventListener('click', hideAdminModal);

// Delegated events
document.addEventListener('click', function(e) {
    // Channel creation
    if (e.target.closest('.add-channel-btn')) {
        const type = e.target.closest('.add-channel-btn').dataset.type;
        showCreateChannelModal(type);
    }
    
    // Server menu
    if (e.target.closest('.invite-server-btn')) {
        const serverId = e.target.closest('.server').dataset.server;
        createInvite(serverId);
    }
    
    if (e.target.closest('.admin-management-btn')) {
        const serverId = e.target.closest('.server').dataset.server;
        showAdminManagementModal(serverId);
    }
    
    if (e.target.closest('.leave-server-btn')) {
        const serverId = e.target.closest('.server').dataset.server;
        leaveServer(serverId);
    }
    
    // Channel context menu
    if (e.target.closest('.edit-channel-btn')) {
        const channelElem = e.target.closest('.channel');
        const channelId = channelElem.dataset.channelId;
        const channelType = channelElem.dataset.channelType;
        showChannelSettingsModal(channelId, channelType);
    }
    
    if (e.target.closest('.delete-channel-btn')) {
        const channelElem = e.target.closest('.channel');
        const channelId = channelElem.dataset.channelId;
        const channelType = channelElem.dataset.channelType;
        deleteChannel(channelId, channelType);
    }
    
    // Remove admin
    if (e.target.classList.contains('remove-admin-btn')) {
        const username = e.target.dataset.user;
        removeAdmin(username);
    }
});

// Channel type settings
document.getElementById('channel-type-select').addEventListener('change', function(e) {
    const type = e.target.value;
    
    document.querySelectorAll('.channel-type-settings').forEach(el => {
        el.style.display = 'none';
    });
    
    document.getElementById(`${type}-channel-settings`).style.display = 'block';
});

// Modal functions
function showCreateServerModal() {
    document.getElementById('create-server-modal').style.display = 'flex';
    document.getElementById('server-name-input').focus();
}

function hideCreateServerModal() {
    document.getElementById('create-server-modal').style.display = 'none';
    document.getElementById('server-name-input').value = '';
}

function showCreateChannelModal(type) {
    document.getElementById('create-channel-modal').style.display = 'flex';
    document.getElementById('channel-type-select').value = type;
    
    document.querySelectorAll('.channel-type-settings').forEach(el => {
        el.style.display = 'none';
    });
    document.getElementById(`${type}-channel-settings`).style.display = 'block';
    
    document.getElementById('channel-name-input').focus();
}

function hideCreateChannelModal() {
    document.getElementById('create-channel-modal').style.display = 'none';
    document.getElementById('channel-name-input').value = '';
}

function showInviteModal(inviteCode) {
    document.getElementById('invite-modal').style.display = 'flex';
    document.getElementById('invite-code-display').textContent = inviteCode;
    document.getElementById('copy-success').style.display = 'none';
}

function hideInviteModal() {
    document.getElementById('invite-modal').style.display = 'none';
}

function showJoinServerModal() {
    document.getElementById('join-server-modal').style.display = 'flex';
    document.getElementById('invite-code-input').focus();
}

function hideJoinServerModal() {
    document.getElementById('join-server-modal').style.display = 'none';
    document.getElementById('invite-code-input').value = '';
    document.getElementById('join-server-message').textContent = '';
}

// Server creation
async function createServer() {
    const serverName = document.getElementById('server-name-input').value.trim();
    
    if (!serverName) {
        alert('Please enter a server name');
        return;
    }
    
    try {
        const response = await fetch('/api/server/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serverName,
                username: currentUser
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            hideCreateServerModal();
            
            userServers.push({
                id: data.serverId,
                name: serverName,
                memberCount: 1
            });
            
            renderServerList();
            switchServer(data.serverId);
        } else {
            alert(data.message || 'Failed to create server');
        }
    } catch (error) {
        console.error('Error creating server:', error);
        alert('Error creating server');
    }
}

// Channel creation
async function createChannel() {
    const channelName = document.getElementById('channel-name-input').value.trim();
    const channelType = document.getElementById('channel-type-select').value;
    
    if (!channelName) {
        alert('Please enter a channel name');
        return;
    }
    
    let settings = {};
    if (channelType === 'text') {
        settings = {
            adminOnly: document.getElementById('text-admin-only').checked,
            slowMode: parseInt(document.getElementById('text-slow-mode').value) || 0
        };
    } else if (channelType === 'announcement') {
        settings = {
            adminOnly: true,
            slowMode: 0
        };
    } else if (channelType === 'voice') {
        settings = {
            userLimit: parseInt(document.getElementById('voice-user-limit').value) || 0,
            currentUsers: []
        };
    }
    
    try {
        const response = await fetch(`/api/server/${currentServer}/channel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channelName,
                channelType,
                username: currentUser,
                settings
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            hideCreateChannelModal();
        } else {
            alert(data.message || 'Failed to create channel');
        }
    } catch (error) {
        console.error('Error creating channel:', error);
        alert('Error creating channel');
    }
}

// Invite management
async function createInvite(serverId) {
    try {
        const response = await fetch(`/api/server/${serverId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showInviteModal(data.inviteCode);
        } else {
            alert(data.message || 'Failed to create invite');
        }
    } catch (error) {
        console.error('Error creating invite:', error);
        alert('Error creating invite');
    }
}

async function joinServer() {
    const inviteCode = document.getElementById('invite-code-input').value.trim();
    
    if (!inviteCode) {
        alert('Please enter an invite code');
        return;
    }
    
    try {
        const response = await fetch(`/api/invite/${inviteCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser })
        });
        
        const data = await response.json();
        
        if (data.success) {
            userServers.push({
                id: data.serverId,
                name: data.serverName,
                memberCount: 1
            });
            
            renderServerList();
            hideJoinServerModal();
            switchServer(data.serverId);
            
            alert(`Joined server: ${data.serverName}`);
        } else {
            document.getElementById('join-server-message').textContent = data.message;
            document.getElementById('join-server-message').style.color = '#f04747';
        }
    } catch (error) {
        console.error('Error joining server:', error);
        alert('Error joining server');
    }
}

function copyInviteCode() {
    const inviteCode = document.getElementById('invite-code-display').textContent;
    navigator.clipboard.writeText(inviteCode)
        .then(() => {
            const successElem = document.getElementById('copy-success');
            successElem.style.display = 'block';
            setTimeout(() => {
                successElem.style.display = 'none';
            }, 2000);
        })
        .catch(err => {
            console.error('Failed to copy:', err);
        });
}

function leaveServer(serverId) {
    if (!confirm('Are you sure you want to leave this server?')) {
        return;
    }
    
    const index = userServers.findIndex(s => s.id === serverId);
    if (index > -1) {
        userServers.splice(index, 1);
    }
    
    if (currentServer === serverId) {
        switchServer('demo');
    }
    
    renderServerList();
}

// Channel settings
function showChannelSettingsModal(channelId, channelType) {
    currentEditingChannel = channelId;
    currentEditingChannelType = channelType;
    
    const modal = document.getElementById('channel-settings-modal');
    const content = document.getElementById('channel-settings-content');
    
    // This would need to fetch actual channel data
    // For now, we'll create a basic form
    let html = '';
    
    if (channelType === 'text' || channelType === 'announcement') {
        html = `
            <div class="channel-settings-section">
                <h4>Permissions</h4>
                <div class="setting-item">
                    <div class="setting-label">
                        <strong>Admin Only</strong>
                        <small>Only admins can send messages</small>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="settings-admin-only">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
            <div class="channel-settings-section">
                <h4>Slow Mode</h4>
                <div class="setting-item">
                    <div class="setting-label">
                        <strong>Delay</strong>
                        <small>Seconds between messages (0 to disable)</small>
                    </div>
                    <input type="number" id="settings-slow-mode" class="number-input" 
                           min="0" max="120" value="0">
                </div>
            </div>
        `;
    } else if (channelType === 'voice') {
        html = `
            <div class="channel-settings-section">
                <h4>User Limit</h4>
                <div class="setting-item">
                    <div class="setting-label">
                        <strong>Maximum Users</strong>
                        <small>0 for unlimited</small>
                    </div>
                    <input type="number" id="settings-user-limit" class="number-input" 
                           min="0" max="99" value="0">
                </div>
            </div>
        `;
    }
    
    content.innerHTML = html;
    modal.style.display = 'flex';
}

function hideChannelSettingsModal() {
    document.getElementById('channel-settings-modal').style.display = 'none';
    currentEditingChannel = null;
    currentEditingChannelType = null;
}

function saveChannelSettings() {
    const channelId = currentEditingChannel;
    const channelType = currentEditingChannelType;
    
    if (!channelId || !channelType) return;
    
    let settings = {};
    
    if (channelType === 'text' || channelType === 'announcement') {
        settings = {
            adminOnly: document.getElementById('settings-admin-only').checked,
            slowMode: parseInt(document.getElementById('settings-slow-mode').value) || 0
        };
    } else if (channelType === 'voice') {
        settings = {
            userLimit: parseInt(document.getElementById('settings-user-limit').value) || 0
        };
    }
    
    socket.emit('update-channel-settings', {
        serverId: currentServer,
        channelId,
        settings,
        channelType
    });
    
    hideChannelSettingsModal();
}

function deleteChannel(channelId, channelType) {
    if (!confirm(`Are you sure you want to delete this channel? This action cannot be undone.`)) {
        return;
    }
    
    socket.emit('delete-channel', {
        serverId: currentServer,
        channelId,
        channelType
    });
}

// Admin management
async function showAdminManagementModal(serverId) {
    const modal = document.getElementById('admin-management-modal');
    const ownerDisplay = document.getElementById('server-owner-display');
    const adminList = document.getElementById('admin-list');
    
    const response = await fetch(`/api/server/${serverId}/info`);
    const data = await response.json();
    
    if (data.success) {
        const server = data.server;
        
        ownerDisplay.innerHTML = `
            <span>${server.owner}</span>
            <span class="owner-badge">Owner</span>
        `;
        
        adminList.innerHTML = '';
        server.admins.forEach(admin => {
            if (admin !== server.owner) {
                const adminElem = document.createElement('div');
                adminElem.className = 'admin-user';
                adminElem.innerHTML = `
                    <span>${admin}</span>
                    ${currentUser === server.owner ? 
                        `<button class="remove-admin-btn" data-user="${admin}" style="background:#f04747;color:white;border:none;padding:3px 8px;border-radius:3px;font-size:12px;cursor:pointer;">Remove</button>` : 
                        `<span class="admin-badge">Admin</span>`
                    }
                `;
                adminList.appendChild(adminElem);
            }
        });
        
        document.querySelector('.add-admin-form').style.display = 
            currentUser === server.owner ? 'flex' : 'none';
        
        modal.style.display = 'flex';
    }
}

function hideAdminModal() {
    document.getElementById('admin-management-modal').style.display = 'none';
}

function addAdmin() {
    const username = document.getElementById('new-admin-input').value.trim();
    
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    socket.emit('add-admin', {
        serverId: currentServer,
        targetUser: username
    });
    
    document.getElementById('new-admin-input').value = '';
}

function removeAdmin(username) {
    if (confirm(`Remove ${username} as admin?`)) {
        socket.emit('remove-admin', {
            serverId: currentServer,
            targetUser: username
        });
    }
}

// Voice chat
async function joinVoiceChannel(channelId) {
    if (currentVoiceChannel) {
        socket.emit('leave-voice', {
            channelId: currentVoiceChannel,
            serverId: currentServer
        });
    }
    
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });
        
        socket.emit('join-voice', {
            channelId,
            serverId: currentServer
        });
        
        currentVoiceChannel = channelId;
        voiceContainer.style.display = 'flex';
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Could not access microphone. Please check permissions.');
    }
}

muteBtn.addEventListener('click', () => {
    if (stream) {
        const audioTracks = stream.getAudioTracks();
        audioTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        muteBtn.innerHTML = track.enabled ? 
            '<i class="fas fa-microphone"></i> Mute' : 
            '<i class="fas fa-microphone-slash"></i> Unmute';
    }
});

leaveVoiceBtn.addEventListener('click', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    
    Object.values(peers).forEach(peer => peer.destroy());
    peers = {};
    
    socket.emit('leave-voice', {
        channelId: currentVoiceChannel,
        serverId: currentServer
    });
    
    voiceContainer.style.display = 'none';
    currentVoiceChannel = null;
});

function updateVoiceUsers(users) {
    voiceUsers.innerHTML = '';
    
    users.forEach(username => {
        const userElem = document.createElement('div');
        userElem.className = 'voice-user';
        userElem.innerHTML = `
            <div class="voice-user-avatar">
                ${getAvatarHTML(username)}
            </div>
            <span>${username}</span>
            ${username === currentUser ? '<span style="color: #43b581;">(You)</span>' : ''}
        `;
        voiceUsers.appendChild(userElem);
    });
}

// Online users
async function updateOnlineUsers(users) {
    const popup = document.getElementById('online-users-popup');
    popup.innerHTML = '';
    
    for (const username of users) {
        const userElem = document.createElement('div');
        userElem.className = 'online-user';
        
        let avatarHTML = getAvatarHTML(username);
        
        userElem.innerHTML = `
            <div class="online-user-avatar">
                ${avatarHTML}
            </div>
            <span>${username}</span>
            ${username === currentUser ? '<span style="color: #43b581;">(You)</span>' : ''}
        `;
        
        popup.appendChild(userElem);
    }
}

// Logout
logoutBtn.addEventListener('click', () => {
    if (socket) {
        socket.disconnect();
    }
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peers).forEach(peer => peer.destroy());
    
    app.style.display = 'none';
    loginScreen.style.display = 'flex';
    currentUser = '';
    usernameInput.value = '';
    passwordInput.value = '';
});