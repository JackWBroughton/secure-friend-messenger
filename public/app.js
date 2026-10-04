const socket = io();

const state = {
  userName: '',
  myCode: '',
  peerSocketId: null,
  peerName: '',
  currentChat: [],
  dataChannel: null,
  peerConnection: null,
  sessionKey: null,
  privateKey: null,
  publicKey: null,
  connected: false
};

const elements = {
  nameInput: document.getElementById('nameInput'),
  saveProfileBtn: document.getElementById('saveProfileBtn'),
  friendCode: document.getElementById('friendCode'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  generateCodeBtn: document.getElementById('generateCodeBtn'),
  copyInviteLinkBtn: document.getElementById('copyInviteLinkBtn'),
  friendCodeInput: document.getElementById('friendCodeInput'),
  connectForm: document.getElementById('connectForm'),
  contactList: document.getElementById('contactList'),
  chatName: document.getElementById('chatName'),
  messageList: document.getElementById('messageList'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput'),
  connectionBadge: document.getElementById('connectionBadge'),
  copyNotification: document.getElementById('copyNotification')
};

const contactStore = new Map();

function generateCode() {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 6; i += 1) {
    value += charset[Math.floor(Math.random() * charset.length)];
  }
  return value;
}

function showCopyNotification(text = 'Copied!') {
  elements.copyNotification.textContent = text;
  elements.copyNotification.classList.add('visible');
  clearTimeout(showCopyNotification.timer);
  showCopyNotification.timer = setTimeout(() => {
    elements.copyNotification.classList.remove('visible');
  }, 1400);
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      showCopyNotification('Copied!');
      return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showCopyNotification('Copied!');
    return true;
  } catch (error) {
    console.error('Copy failed:', error);
    showCopyNotification('Copy failed');
    return false;
  }
}

function getInviteLink() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = state.myCode || '';
  return url.toString();
}

function readInviteFromUrl() {
  const hashCode = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
  const params = new URLSearchParams(window.location.search);
  const friendCode = hashCode || params.get('c') || params.get('friend');
  if (!friendCode) return;
  const normalized = friendCode.trim();
  if (normalized.length === 6) {
    elements.friendCodeInput.value = normalized;
    showCopyNotification('Invite code ready');
  }
}

function loadProfile() {
  const saved = localStorage.getItem('secure-friend-messenger-profile');
  if (saved) {
    try {
      const profile = JSON.parse(saved);
      state.userName = profile.name || 'Me';
      state.myCode = profile.code || generateCode();
    } catch (error) {
      state.userName = 'Me';
      state.myCode = generateCode();
    }
  } else {
    state.userName = 'Me';
    state.myCode = generateCode();
  }

  elements.nameInput.value = state.userName;
  elements.friendCode.textContent = state.myCode;
  socket.emit('register-code', { code: state.myCode, name: state.userName });
}

function saveProfile() {
  const name = (elements.nameInput.value || '').trim() || 'Me';
  state.userName = name;
  state.myCode = state.myCode || generateCode();
  localStorage.setItem(
    'secure-friend-messenger-profile',
    JSON.stringify({ name: state.userName, code: state.myCode })
  );
  elements.friendCode.textContent = state.myCode;
  socket.emit('register-code', { code: state.myCode, name: state.userName });
}

function renderContacts() {
  elements.contactList.innerHTML = '';

  if (contactStore.size === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'contact-row';
    emptyItem.innerHTML = '<span class="contact-name">No friends yet</span>';
    elements.contactList.appendChild(emptyItem);
    return;
  }

  contactStore.forEach((contact, id) => {
    const item = document.createElement('li');
    item.className = 'contact-row';
    item.innerHTML = `
      <div>
        <div class="contact-name">${contact.name}</div>
        <div class="contact-code">${contact.code}</div>
      </div>
      <button class="secondary-btn" data-target="${id}" type="button">Open</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      state.peerSocketId = id;
      state.peerName = contact.name;
      elements.chatName.textContent = contact.name;
      updateConnectionStatus(true);
    });
    elements.contactList.appendChild(item);
  });
}

function updateConnectionStatus(online) {
  elements.connectionBadge.textContent = online ? 'Connected' : 'Offline';
  elements.connectionBadge.classList.toggle('online', online);
  elements.connectionBadge.classList.toggle('offline', !online);
}

function clearChat() {
  state.currentChat = [];
  elements.messageList.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'message-row incoming';
  empty.innerHTML = '<span class="message-meta">System</span>Connect with a friend code to start a secure conversation.';
  elements.messageList.appendChild(empty);
}

function renderMessages() {
  elements.messageList.innerHTML = '';

  if (!state.currentChat.length) {
    clearChat();
    return;
  }

  state.currentChat.forEach((message) => {
    const row = document.createElement('div');
    row.className = `message-row ${message.side}`;
    row.innerHTML = `<span class="message-meta">${message.author}</span><div>${message.text}</div>`;
    elements.messageList.appendChild(row);
  });

  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function addChatMessage(side, author, text) {
  state.currentChat.push({ side, author, text });
  renderMessages();
}

async function createSessionKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  state.privateKey = keyPair.privateKey;
  const exportedPublicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  state.publicKey = exportedPublicKey;
  return exportedPublicKey;
}

async function deriveSharedKey(peerPublicKeyRaw) {
  const importedPeerKey = await crypto.subtle.importKey(
    'raw',
    peerPublicKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );

  return crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: importedPeerKey
    },
    state.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(text);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.sessionKey, data);

  return {
    type: 'chat',
    iv: Array.from(iv),
    payload: Array.from(new Uint8Array(encrypted))
  };
}

async function decryptText(payload) {
  const iv = new Uint8Array(payload.iv);
  const encrypted = new Uint8Array(payload.payload);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, state.sessionKey, encrypted);
  return new TextDecoder().decode(decrypted);
}

function attachChannelHandlers(channel) {
  channel.onopen = () => {
    updateConnectionStatus(true);
    if (!state.peerName) {
      elements.chatName.textContent = 'Connected';
    }
  };

  channel.onclose = () => {
    updateConnectionStatus(false);
    elements.chatName.textContent = 'No friend connected';
  };

  channel.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (!payload.type || payload.type !== 'chat') {
        return;
      }

      const plaintext = await decryptText(payload);
      addChatMessage('incoming', state.peerName || 'Friend', plaintext);
    } catch (error) {
      addChatMessage('incoming', 'Security', 'Could not decrypt message.');
    }
  };
}

async function startConnection(role) {
  if (!state.peerSocketId) return;

  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  state.peerConnection = peerConnection;

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) return;

    socket.emit('signal', {
      toSocketId: state.peerSocketId,
      message: {
        type: 'ice-candidate',
        candidate: event.candidate
      }
    });
  };

  peerConnection.ondatachannel = (event) => {
    state.dataChannel = event.channel;
    attachChannelHandlers(state.dataChannel);
  };

  if (role === 'offerer') {
    const outgoingChannel = peerConnection.createDataChannel('secure-chat');
    state.dataChannel = outgoingChannel;
    attachChannelHandlers(outgoingChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('signal', {
      toSocketId: state.peerSocketId,
      message: {
        type: 'offer',
        sdp: offer
      }
    });
  }
}

async function handleIncomingSignal(payload) {
  const { fromSocketId, message } = payload;
  if (!fromSocketId || !message) return;

  if (message.type === 'public-key' && !state.sessionKey) {
    const derivedKey = await deriveSharedKey(message.publicKey);
    state.sessionKey = derivedKey;
    return;
  }

  if (!state.peerConnection) {
    await startConnection('answerer');
  }

  if (message.type === 'offer') {
    const offer = new RTCSessionDescription(message.sdp);
    await state.peerConnection.setRemoteDescription(offer);
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);

    socket.emit('signal', {
      toSocketId: fromSocketId,
      message: {
        type: 'answer',
        sdp: answer
      }
    });
    return;
  }

  if (message.type === 'answer') {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
    return;
  }

  if (message.type === 'ice-candidate') {
    if (!state.peerConnection) return;
    try {
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
    } catch (error) {
      console.warn('ICE candidate error', error);
    }
  }
}

socket.on('registered', ({ code }) => {
  state.myCode = code;
  elements.friendCode.textContent = code;
  localStorage.setItem('secure-friend-messenger-profile', JSON.stringify({ name: state.userName, code: state.myCode }));
});

socket.on('peer-not-found', ({ message }) => {
  alert(message);
});

socket.on('match-found', async ({ peerId, partnerName, role, code }) => {
  state.peerSocketId = peerId;
  state.peerName = partnerName;
  elements.chatName.textContent = partnerName;
  state.connected = true;
  updateConnectionStatus(true);

  contactStore.set(peerId, { name: partnerName, code });
  renderContacts();

  const exportedPublicKey = await createSessionKeyPair();
  socket.emit('signal', {
    toSocketId: peerId,
    message: {
      type: 'public-key',
      publicKey: exportedPublicKey
    }
  });

  if (role === 'offerer') {
    await startConnection('offerer');
  } else {
    await startConnection('answerer');
  }
});

socket.on('signal', async (payload) => {
  await handleIncomingSignal(payload);
});

function bindCopyControls() {
  elements.copyCodeBtn.addEventListener('click', async () => {
    const code = state.myCode || elements.friendCode.textContent || '';
    if (!code || code.includes('-')) {
      showCopyNotification('No code yet');
      return;
    }
    await copyTextToClipboard(code);
  });

  elements.copyInviteLinkBtn.addEventListener('click', async () => {
    const link = getInviteLink();
    await copyTextToClipboard(link);
  });
}

elements.saveProfileBtn.addEventListener('click', saveProfile);

elements.generateCodeBtn.addEventListener('click', () => {
  state.myCode = generateCode();
  elements.friendCode.textContent = state.myCode;
  localStorage.setItem('secure-friend-messenger-profile', JSON.stringify({ name: state.userName, code: state.myCode }));
  socket.emit('register-code', { code: state.myCode, name: state.userName });
});

elements.connectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = (elements.friendCodeInput.value || '').trim();
  if (!code) {
    alert('Enter a 6-character friend code to connect.');
    return;
  }

  if (code === state.myCode) {
    alert('You cannot connect to your own code.');
    return;
  }

  socket.emit('connect-by-code', { code, name: state.userName });
  elements.friendCodeInput.value = '';
});

elements.messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = (elements.messageInput.value || '').trim();
  if (!message || !state.dataChannel || !state.sessionKey) {
    addChatMessage('incoming', 'System', 'You are not connected to a secure friend yet.');
    return;
  }

  const encrypted = await encryptText(message);
  state.dataChannel.send(JSON.stringify(encrypted));
  addChatMessage('outgoing', 'You', message);
  elements.messageInput.value = '';
});

window.addEventListener('DOMContentLoaded', () => {
  clearChat();
  readInviteFromUrl();
  loadProfile();
  renderContacts();
  bindCopyControls();
});
