// Global variables
let currentUser = null;
let currentServer = null;
let currentChannel = null;
let socket = null;
let peerConnections = {};
let localStream = null;
let cameraEnabled = false;
let micEnabled = true;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in
    const savedUser = localStorage.getItem('discord_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        initApp();
    } else {
        showModal('loginModal');
    }
    
    // Event listeners
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('registerBtn').addEventListener('click', register);
    document.getElementById('showRegister').addEventListener('click', () => {
        showModal('registerModal');
        hideModal('loginModal');
    });
    document.getElementById('showLogin').addEventListener('click', () => {
        showModal('loginModal');
        hideModal('registerModal');
    });
    document.getElementById('createServerBtn').addEventListener('click', () => {
        showModal('createServerModal');
    });
    document.getElementById('createServerConfirmBtn').addEventListener('click', createServer);
    document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Voice controls
    document.getElementById('micToggleBtn').addEventListener('click', toggleMicrophone);
    document.getElementById('cameraToggleBtn').addEventListener('click', toggleCamera);
    document.getElementById('leaveVoiceBtn').addEventListener('click', leaveVoiceChannel);
    document.getElementById('closeVoiceBtn').addEventListener('click', () => {
        document.getElementById('voicePanel').style.display = 'none';
    });
});

// Initialize application
async function initApp() {
    hideAllModals();
    
    // Load user profile
    loadUserProfile();
    
    // Load servers
    loadServers();
    
    // Connect to Socket.io
    socket = io();
    
    // Setup socket listeners
    setupSocketListeners();
}

// Socket.io listeners
function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
    });
    
    socket.on('new_message', (message) => {
        if (message.channel_id === currentChannel?.id) {
            addMessageToChat(message);
        }
    });
    
    // Voice chat listeners
    socket.on('user_joined_voice', (data) => {
        console.log('User joined voice:', data);
        addVoiceUser(data);
        createPeerConnection(data.socketId, true);
    });
    
    socket.on('existing_voice_users', (users) => {
        users.forEach(user => {
            if (user.userId !== currentUser.id) {
                addVoiceUser(user);
                createPeerConnection(user.socketId, false);
            }
        });
    });
    
    socket.on('offer', async (data) => {
        console.log('Received offer from:', data.sender);
        const peerConnection = getOrCreatePeerConnection(data.sender);
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
        
        if (data.cameraEnabled) {
            // Remote user has camera enabled
        }
    });
    
    socket.on('answer', async (data) => {
        console.log('Received answer from:', data.sender);
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });
    
    socket.on('ice-candidate', async (data) => {
        console.log('Received ICE candidate from:', data.sender);
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                console.error('Error adding ICE candidate:', e);
            }
        }
    });
    
    socket.on('user_left_voice', (data) => {
        console.log('User left voice:', data);
        removeVoiceUser(data.socketId);
        removePeerConnection(data.socketId);
    });
    
    socket.on('camera_toggled', (data) => {
        console.log('Camera toggled:', data);
        // Update UI for remote user's camera
    });
}

// Authentication functions
async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const user = await response.json();
        if (response.ok) {
            currentUser = user;
            localStorage.setItem('discord_user', JSON.stringify(user));
            initApp();
        } else {
            alert(user.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed');
    }
}

async function register() {
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert('Registration successful! Please login.');
            showModal('loginModal');
            hideModal('registerModal');
        } else {
            alert(result.error || 'Registration failed');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Registration failed');
    }
}

// Server and channel management
async function loadServers() {
    try {
        const response = await fetch('/api/servers');
        const servers = await response.json();
        
        const serverList = document.getElementById('serverList');
        serverList.innerHTML = '';
        
        servers.forEach(server => {
            const serverElement = document.createElement('div');
            serverElement.className = 'server-icon';
            serverElement.textContent = server.name.charAt(0);
            serverElement.title = server.name;
            serverElement.dataset.id = server.id;
            
            serverElement.addEventListener('click', () => {
                selectServer(server);
            });
            
            serverList.appendChild(serverElement);
        });
        
        // Select first server by default
        if (servers.length > 0 && !currentServer) {
            selectServer(servers[0]);
        }
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

async function selectServer(server) {
    currentServer = server;
    document.getElementById('currentServer').innerHTML = `<h3>${server.name}</h3>`;
    
    // Highlight selected server
    document.querySelectorAll('.server-icon').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.id == server.id) el.classList.add('active');
    });
    
    // Load server channels
    await loadChannels(server.id);
}

async function loadChannels(serverId) {
    try {
        const response = await fetch(`/api/servers/${serverId}/channels`);
        const channels = await response.json();
        
        const textChannels = document.getElementById('textChannels');
        const voiceChannels = document.getElementById('voiceChannels');
        
        textChannels.innerHTML = '';
        voiceChannels.innerHTML = '';
        
        channels.forEach(channel => {
            const channelElement = document.createElement('li');
            channelElement.textContent = channel.name;
            channelElement.dataset.id = channel.id;
            channelElement.dataset.type = channel.type;
            
            channelElement.addEventListener('click', () => {
                if (channel.type === 'text') {
                    selectTextChannel(channel);
                } else if (channel.type === 'voice') {
                    joinVoiceChannel(channel);
                }
            });
            
            if (channel.type === 'text') {
                textChannels.appendChild(channelElement);
            } else {
                const voiceIcon = document.createElement('i');
                voiceIcon.className = 'fas fa-volume-up';
                channelElement.prepend(voiceIcon);
                voiceChannels.appendChild(channelElement);
            }
        });
        
        // Select first text channel by default
        const firstTextChannel = channels.find(c => c.type === 'text');
        if (firstTextChannel) {
            selectTextChannel(firstTextChannel);
        }
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}

async function selectTextChannel(channel) {
    currentChannel = channel;
    document.getElementById('currentChannel').textContent = `#${channel.name}`;
    document.getElementById('messageInput').placeholder = `Message #${channel.name}`;
    
    // Highlight selected channel
    document.querySelectorAll('#textChannels li').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.id == channel.id) el.classList.add('active');
    });
    
    // Load messages for this channel
    await loadMessages(channel.id);
    
    // Join socket room for this channel
    if (socket) {
        socket.emit('join_channel', {
            channel_id: channel.id,
            server_id: currentServer.id
        });
    }
}

async function loadMessages(channelId) {
    try {
        const response = await fetch(`/api/channels/${channelId}/messages`);
        const messages = await response.json();
        
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '';
        
        messages.forEach(message => {
            addMessageToChat(message);
        });
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function addMessageToChat(message) {
    const chatMessages = document.getElementById('chatMessages');
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    
    // Format timestamp
    const date = new Date(message.created_at);
    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Get avatar URL - handle default avatar
    let avatarUrl = message.avatar;
    if (!avatarUrl || avatarUrl === 'default.png') {
        avatarUrl = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(message.username) + '&background=random';
    } else if (!avatarUrl.startsWith('http')) {
        avatarUrl = message.avatar;
    }
    
    messageElement.innerHTML = `
        <img src="${avatarUrl}" alt="${message.username}" class="avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(message.username)}&background=random'">
        <div class="message-content">
            <div class="message-header">
                <span class="username">${message.username}</span>
                <span class="timestamp">${timeString}</span>
            </div>
            <div class="message-text">${message.content}</div>
        </div>
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    
    if (!content || !currentUser || !currentChannel) return;
    
    try {
        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: content,
                user_id: currentUser.id,
                channel_id: currentChannel.id
            })
        });
        
        if (response.ok) {
            input.value = '';
        }
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

async function createServer() {
    const name = document.getElementById('serverName').value.trim();
    if (!name) return;
    
    try {
        const response = await fetch('/api/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                owner_id: currentUser.id
            })
        });
        
        if (response.ok) {
            hideModal('createServerModal');
            document.getElementById('serverName').value = '';
            loadServers();
        }
    } catch (error) {
        console.error('Error creating server:', error);
        alert('Failed to create server');
    }
}

// User profile functions
function loadUserProfile() {
    const userProfile = document.getElementById('userProfile');
    
    // Get avatar URL
    let avatarUrl = currentUser.avatar;
    if (!avatarUrl || avatarUrl === 'default.png') {
        avatarUrl = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(currentUser.username) + '&background=random';
    }
    
    userProfile.innerHTML = `
        <img src="${avatarUrl}" alt="${currentUser.username}" class="user-avatar" id="userAvatar">
        <div class="user-info">
            <span class="username">${currentUser.username}</span>
            <input type="file" id="avatarUpload" accept="image/*" style="display: none;">
        </div>
    `;
    
    // Add click event to avatar for upload
    document.getElementById('userAvatar').addEventListener('click', () => {
        document.getElementById('avatarUpload').click();
    });
    
    document.getElementById('avatarUpload').addEventListener('change', uploadAvatar);
}

async function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('user_id', currentUser.id);
    
    try {
        const response = await fetch('/api/upload-avatar', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            currentUser.avatar = result.avatar;
            localStorage.setItem('discord_user', JSON.stringify(currentUser));
            loadUserProfile();
        }
    } catch (error) {
        console.error('Error uploading avatar:', error);
    }
}

// Voice chat functions
async function joinVoiceChannel(channel) {
    if (!socket) {
        alert('Not connected to server');
        return;
    }
    
    // Show voice panel
    document.getElementById('voicePanel').style.display = 'block';
    document.getElementById('currentChannel').textContent = `🔊 ${channel.name}`;
    
    try {
        // Get user media (audio and video)
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: cameraEnabled
        });
        
        // Show local video if camera is enabled
        if (cameraEnabled && localStream.getVideoTracks().length > 0) {
            addLocalVideoStream();
        }
        
        // Join voice channel on server
        socket.emit('join_voice', {
            channelId: channel.id,
            userId: currentUser.id,
            username: currentUser.username
        });
        
        // Update UI
        document.getElementById('cameraToggleBtn').innerHTML = cameraEnabled ? 
            '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access microphone/camera. Please check permissions.');
    }
}

function createPeerConnection(socketId, isInitiator) {
    if (peerConnections[socketId]) {
        return peerConnections[socketId];
    }
    
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });
    
    peerConnections[socketId] = peerConnection;
    
    // Add local stream tracks to connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: socketId,
                candidate: event.candidate
            });
        }
    };
    
    // Handle remote stream
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream from:', socketId);
        addRemoteVideoStream(socketId, event.streams[0]);
    };
    
    // Create offer if initiator
    if (isInitiator) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                socket.emit('offer', {
                    target: socketId,
                    offer: peerConnection.localDescription,
                    cameraEnabled: cameraEnabled
                });
            })
            .catch(error => {
                console.error('Error creating offer:', error);
            });
    }
    
    return peerConnection;
}

function getOrCreatePeerConnection(socketId) {
    if (!peerConnections[socketId]) {
        return createPeerConnection(socketId, false);
    }
    return peerConnections[socketId];
}

function addVoiceUser(user) {
    const voiceUsers = document.getElementById('voiceUsers');
    
    const userElement = document.createElement('div');
    userElement.className = 'voice-user';
    userElement.id = `voice-user-${user.socketId}`;
    userElement.innerHTML = `
        <i class="fas fa-user"></i>
        <span>${user.username}</span>
    `;
    
    voiceUsers.appendChild(userElement);
}

function removeVoiceUser(socketId) {
    const userElement = document.getElementById(`voice-user-${socketId}`);
    if (userElement) {
        userElement.remove();
    }
    
    // Remove video element if exists
    const videoElement = document.getElementById(`video-${socketId}`);
    if (videoElement) {
        videoElement.remove();
    }
}

function removePeerConnection(socketId) {
    if (peerConnections[socketId]) {
        peerConnections[socketId].close();
        delete peerConnections[socketId];
    }
}

function addLocalVideoStream() {
    const videoContainer = document.getElementById('videoContainer');
    
    // Remove existing local video if any
    const existingVideo = document.getElementById('local-video');
    if (existingVideo) existingVideo.remove();
    
    if (localStream && cameraEnabled) {
        const videoElement = document.createElement('video');
        videoElement.id = 'local-video';
        videoElement.autoplay = true;
        videoElement.muted = true;
        videoElement.srcObject = localStream;
        videoElement.className = 'local-video';
        
        videoContainer.appendChild(videoElement);
    }
}

function addRemoteVideoStream(socketId, stream) {
    const videoContainer = document.getElementById('videoContainer');
    
    // Remove existing video for this user if any
    const existingVideo = document.getElementById(`video-${socketId}`);
    if (existingVideo) existingVideo.remove();
    
    const videoElement = document.createElement('video');
    videoElement.id = `video-${socketId}`;
    videoElement.autoplay = true;
    videoElement.srcObject = stream;
    videoElement.className = 'remote-video';
    
    videoContainer.appendChild(videoElement);
}

async function toggleCamera() {
    if (!localStream) return;
    
    cameraEnabled = !cameraEnabled;
    
    if (cameraEnabled) {
        // Enable camera
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = videoStream.getVideoTracks()[0];
            
            // Replace video track in local stream
            const existingVideoTrack = localStream.getVideoTracks()[0];
            if (existingVideoTrack) {
                existingVideoTrack.stop();
                localStream.removeTrack(existingVideoTrack);
            }
            localStream.addTrack(videoTrack);
            
            // Update all peer connections
            Object.values(peerConnections).forEach(pc => {
                const senders = pc.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    videoSender.replaceTrack(videoTrack);
                }
            });
            
            addLocalVideoStream();
        } catch (error) {
            console.error('Error enabling camera:', error);
            cameraEnabled = false;
        }
    } else {
        // Disable camera
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.stop();
            localStream.removeTrack(videoTrack);
            
            // Remove local video
            const localVideo = document.getElementById('local-video');
            if (localVideo) localVideo.remove();
        }
    }
    
    // Update UI
    document.getElementById('cameraToggleBtn').innerHTML = cameraEnabled ? 
        '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
    
    // Notify others
    if (socket && currentChannel) {
        socket.emit('toggle_camera', {
            channelId: currentChannel.id,
            userId: currentUser.id,
            enabled: cameraEnabled
        });
    }
}

function toggleMicrophone() {
    if (!localStream) return;
    
    micEnabled = !micEnabled;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = micEnabled;
    }
    
    // Update UI
    document.getElementById('micToggleBtn').innerHTML = micEnabled ? 
        '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
}

async function leaveVoiceChannel() {
    if (!socket || !currentChannel) return;
    
    // Notify server
    socket.emit('leave_voice', {
        channelId: currentChannel.id,
        userId: currentUser.id
    });
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    // Clear UI
    document.getElementById('voiceUsers').innerHTML = '';
    document.getElementById('videoContainer').innerHTML = '';
    document.getElementById('voicePanel').style.display = 'none';
    
    // Reset to text channel view
    if (currentServer) {
        const textChannels = document.querySelectorAll('#textChannels li');
        if (textChannels.length > 0) {
            textChannels[0].click();
        }
    }
}

// Modal helper functions
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function hideAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}
