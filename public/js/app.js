const socket = io();

let currentApiKey = localStorage.getItem('wa_api_key') || 'wagateway_secret_key_123';
let currentWebhookUrl = '';
let currentSessionId = 'default';
const sessionHeaders = headers => ({ ...headers, 'x-session-id': currentSessionId });

// Check Status from REST API as well as Socket.io
async function checkStatus() {
  try {
    const res = await fetch(`/api/status?session_id=${encodeURIComponent(currentSessionId)}`);
    const data = await res.json();
    if (data.status && data.data) {
      updateStatusUI(data.data);
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

// Socket.io Realtime Listeners
socket.on('connect', () => {
  console.log('Socket.io connected to server');
  checkStatus();
});

socket.on('status-update', (data) => {
  if (data.session_id === currentSessionId) updateStatusUI(data);
  loadSessions();
});

async function loadSessions() {
  const res = await fetch('/api/sessions'); const result = await res.json();
  if (!result.status) return;
  const selector = document.getElementById('session-selector'); if (!selector) return;
  if (!result.data.some(s => s.session_id === currentSessionId)) currentSessionId = 'default';
  selector.innerHTML = result.data.map(s => `<option value="${escapeHtml(s.session_id)}">${escapeHtml(s.session_id)} — ${s.status}</option>`).join('');
  selector.value = currentSessionId;
}
function selectSession(id) { currentSessionId = id; loadSettings(); checkStatus(); loadLogs(); }
async function createSession() {
  const session_id = prompt('Nama sesi/HP baru (contoh: sales_2):'); if (!session_id) return;
  const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id }) });
  const data = await res.json(); if (!data.status) return showToast(data.message, 'error');
  currentSessionId = session_id; await loadSessions(); await loadSettings(); checkStatus(); showToast('Sesi baru dibuat. Scan QR untuk HP ini.', 'success');
}
async function deleteSelectedSession() {
  if (currentSessionId === 'default') {
    showToast('Sesi utama tidak dapat dihapus dari tombol ini. Gunakan Putuskan Sesi bila ingin mengganti nomor utama.', 'info');
    return;
  }
  if (!confirm(`Hapus HP/sesi "${currentSessionId}"? QR dan data login perangkat ini akan dihapus.`)) return;
  try {
    const res = await fetch('/api/session/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': currentApiKey, 'x-session-id': currentSessionId, 'Authorization': 'Bearer ' + localStorage.getItem('wa_token') },
      body: JSON.stringify({ session_id: currentSessionId })
    });
    const data = await res.json();
    if (!data.status) return showToast(`Gagal menghapus HP: ${data.message}`, 'error');
    currentSessionId = 'default';
    await loadSessions(); await loadSettings(); checkStatus();
    showToast('HP berhasil dihapus.', 'success');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

socket.on('new-message', (data) => {
  showToast(`Pesan baru dari ${data.from}: ${data.message}`, 'info');
  loadLogs();
});

// Tab Switcher
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('tab-active', 'text-emerald-400');
    btn.classList.add('text-gray-400');
  });

  const activeBtn = document.getElementById(`tab-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.add('tab-active');
    activeBtn.classList.remove('text-gray-400');
  }

  const sections = ['connection', 'single-sender', 'bulk-sender', 'logs', 'api-docs', 'users'];
  sections.forEach(sec => {
    const el = document.getElementById(`sec-${sec}`);
    if (el) el.classList.add('hidden');
  });

  const targetSec = document.getElementById(`sec-${tabName}`);
  if (targetSec) targetSec.classList.remove('hidden');

  if (tabName === 'logs') {
    loadLogs();
  } else if (tabName === 'users') {
    loadUsers();
  }
}

// Update Connection UI
function updateStatusUI(data) {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const qrLoading = document.getElementById('qr-loading');
  const qrWrapper = document.getElementById('qr-wrapper');
  const qrImage = document.getElementById('qr-image');
  const connectedWrapper = document.getElementById('connected-wrapper');
  const userInfo = document.getElementById('user-info');
  const userPhone = document.getElementById('user-phone');
  const btnLogout = document.getElementById('btn-logout');

  const status = data.status;

  if (status === 'CONNECTED') {
    statusBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    statusText.innerText = 'TERHUBUNG';

    qrLoading.classList.add('hidden');
    qrWrapper.classList.add('hidden');
    connectedWrapper.classList.remove('hidden');
    btnLogout.classList.remove('hidden');

    if (data.user) {
      userInfo.classList.remove('hidden');
      userPhone.innerText = `${data.user.name} (${data.user.phone})`;
    }
  } else if (status === 'QR_READY' && data.qr) {
    statusBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-2 bg-blue-500/20 text-blue-400 border border-blue-500/30';
    statusText.innerText = 'SIAP SCAN QR';

    qrLoading.classList.add('hidden');
    connectedWrapper.classList.add('hidden');
    qrWrapper.classList.remove('hidden');
    qrImage.src = data.qr;
    btnLogout.classList.add('hidden');
    userInfo.classList.add('hidden');
  } else if (status === 'CONNECTING') {
    statusBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
    statusText.innerText = 'MENGHUBUNGKAN...';

    qrLoading.classList.remove('hidden');
    qrWrapper.classList.add('hidden');
    connectedWrapper.classList.add('hidden');
    btnLogout.classList.add('hidden');
    userInfo.classList.add('hidden');
  } else {
    statusBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-2 bg-red-500/20 text-red-400 border border-red-500/30';
    statusText.innerText = 'TERPUTUS';

    qrLoading.classList.remove('hidden');
    qrWrapper.classList.add('hidden');
    connectedWrapper.classList.add('hidden');
    btnLogout.classList.add('hidden');
    userInfo.classList.add('hidden');
  }
}

// Media type selector toggle
function toggleMediaType() {
  const type = document.getElementById('send-type').value;
  const fileField = document.getElementById('field-media-file');
  const urlField = document.getElementById('field-media-url');

  if (type === 'media_file') {
    fileField.classList.remove('hidden');
    urlField.classList.add('hidden');
  } else if (type === 'media_url') {
    urlField.classList.remove('hidden');
    fileField.classList.add('hidden');
  } else {
    fileField.classList.add('hidden');
    urlField.classList.add('hidden');
  }
}

// Single Message Handler
async function handleSendSingle(event) {
  event.preventDefault();
  const to = document.getElementById('send-to').value;
  const type = document.getElementById('send-type').value;
  const message = document.getElementById('send-message').value;
  const btn = document.getElementById('btn-send-single');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Mengirim...</span>';

  try {
    let endpoint = '/api/send-text';
    let body;
    let headers = { 'x-api-key': currentApiKey };

    if (type === 'text') {
      headers = sessionHeaders(headers); body = JSON.stringify({ to, message, session_id: currentSessionId });
      headers['Content-Type'] = 'application/json';
    } else if (type === 'media_url') {
      endpoint = '/api/send-media';
      const mediaUrl = document.getElementById('send-url').value;
      headers = sessionHeaders(headers); body = JSON.stringify({ to, caption: message, media_url: mediaUrl, session_id: currentSessionId });
      headers['Content-Type'] = 'application/json';
    } else if (type === 'media_file') {
      endpoint = '/api/send-media';
      const formData = new FormData();
      formData.append('to', to);
      formData.append('caption', message);
      formData.append('session_id', currentSessionId);
      const fileInput = document.getElementById('send-file');
      if (fileInput.files.length > 0) {
        formData.append('file', fileInput.files[0]);
      }
      headers = sessionHeaders(headers); body = formData;
    }

    const res = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await res.json();

    if (data.status) {
      showToast('Pesan berhasil dikirim!', 'success');
      document.getElementById('send-message').value = '';
    } else {
      showToast('Gagal mengirim pesan: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>Kirim Pesan Sekarang</span>';
  }
}

// Bulk Message Handler
async function handleSendBulk(event) {
  event.preventDefault();
  const numbersText = document.getElementById('bulk-numbers').value;
  const message = document.getElementById('bulk-message').value;
  const delay = document.getElementById('bulk-delay').value;
  const btn = document.getElementById('btn-send-bulk');

  const numbers = numbersText.split('\n').map(n => n.trim()).filter(Boolean);

  if (numbers.length === 0) {
    showToast('Masukkan minimal satu nomor tujuan', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Memulai Broadcast...</span>';

  try {
    const res = await fetch('/api/send-bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': currentApiKey, 'x-session-id': currentSessionId,
        'Authorization': 'Bearer ' + localStorage.getItem('wa_token')
      },
      body: JSON.stringify({ numbers, message, delay: parseInt(delay), session_id: currentSessionId })
    });

    const data = await res.json();
    if (data.status) {
      showToast(`Broadcast dimulai untuk ${numbers.length} nomor!`, 'success');
    } else {
      showToast('Gagal memproses broadcast: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-bullhorn"></i><span>Mulai Kirim Broadcast</span>';
  }
}

// Load Logs Table
async function loadLogs() {
  const tbody = document.getElementById('logs-tbody');

  try {
    const res = await fetch(`/api/logs?limit=50&session_id=${encodeURIComponent(currentSessionId)}`, {
      headers: { 'x-api-key': currentApiKey, 'x-session-id': currentSessionId }
    });
    const result = await res.json();

    if (!result.status) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-400">${result.message}</td></tr>`;
      return;
    }

    const logs = result.data;
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Belum ada riwayat pesan.</td></tr>`;
      return;
    }

    let sentCount = 0;
    let recvCount = 0;
    let failCount = 0;

    let html = '';
    logs.forEach(log => {
      if (log.type === 'sent' && log.status === 'success') sentCount++;
      if (log.type === 'received') recvCount++;
      if (log.status === 'failed') failCount++;

      const dateStr = new Date(log.created_at).toLocaleString('id-ID');
      const badgeType = log.type === 'sent'
        ? '<span class="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">SENT</span>'
        : '<span class="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30">RECV</span>';

      const badgeStatus = log.status === 'success'
        ? '<span class="text-emerald-400"><i class="fa-solid fa-circle-check"></i> Sukses</span>'
        : `<span class="text-red-400"><i class="fa-solid fa-circle-xmark"></i> ${log.error || 'Gagal'}</span>`;

      html += `
        <tr class="hover:bg-gray-700/30 transition">
          <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-400">${dateStr}</td>
          <td class="px-4 py-3">${badgeType}</td>
          <td class="px-4 py-3 font-mono font-semibold text-white">${log.phone_number}</td>
          <td class="px-4 py-3 max-w-xs truncate">${escapeHtml(log.message || '')}</td>
          <td class="px-4 py-3 text-xs">${badgeStatus}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    // Update Quick Stats
    document.getElementById('stat-sent').innerText = sentCount;
    document.getElementById('stat-received').innerText = recvCount;
    document.getElementById('stat-failed').innerText = failCount;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-400">Error loading logs: ${err.message}</td></tr>`;
  }
}

// Request Pairing Code
async function requestPairingCode() {
  const phone = document.getElementById('pairing-phone').value;
  if (!phone) {
    showToast('Masukkan nomor HP untuk pairing', 'error');
    return;
  }

  try {
    const res = await fetch('/api/pairing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': currentApiKey, 'x-session-id': currentSessionId,
        'Authorization': 'Bearer ' + localStorage.getItem('wa_token')
      },
      body: JSON.stringify({ phone_number: phone, session_id: currentSessionId })
    });
    const data = await res.json();
    if (data.status) {
      alert(`Kode Pairing Anda: ${data.pairingCode}`);
    } else {
      showToast('Gagal: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Logout WhatsApp Session
async function logoutSession() {
  if (!confirm('Apakah Anda yakin ingin memutuskan sesi WhatsApp ini?')) return;

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.disabled = true;
    btnLogout.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Memutuskan Sesi...</span>';
  }

  try {
    const res = await fetch('/api/session/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': currentApiKey, 'x-session-id': currentSessionId
      },
      body: JSON.stringify({ session_id: currentSessionId })
    });
    const data = await res.json();
    if (data.status) {
      showToast('Sesi WhatsApp berhasil diputuskan. Menyiapkan QR Code baru...', 'success');
      setTimeout(() => {
        checkStatus();
      }, 1800);
    } else {
      showToast('Gagal memutuskan sesi: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (btnLogout) {
      btnLogout.disabled = false;
      btnLogout.innerHTML = '<i class="fa-solid fa-power-off"></i><span>Putuskan Sesi</span>';
    }
  }
}

// Force Refresh / Re-generate QR Code
async function refreshQR() {
  showToast('Membuat QR Code baru...', 'info');
  try {
    const res = await fetch('/api/qr/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': currentApiKey,
        'Authorization': 'Bearer ' + localStorage.getItem('wa_token')
      },
      body: JSON.stringify({ session_id: currentSessionId })
    });
    const data = await res.json();
    if (data.status) {
      showToast('QR Code baru berhasil di-generate!', 'success');
      setTimeout(() => {
        checkStatus();
      }, 1500);
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Settings Load & Save
async function loadSettings() {
  try {
    const res = await fetch(`/api/settings?session_id=${encodeURIComponent(currentSessionId)}`);
    const result = await res.json();
    if (result.status && result.data) {
      currentApiKey = result.data.api_key || currentApiKey;
      currentWebhookUrl = result.data.webhook_url || '';

      localStorage.setItem('wa_api_key', currentApiKey);
      document.getElementById('setting-api-key').value = currentApiKey;
      document.getElementById('setting-webhook-url').value = currentWebhookUrl;
    }
  } catch (e) {
    document.getElementById('setting-api-key').value = currentApiKey;
  }
}

async function handleSaveSettings(event) {
  event.preventDefault();
  const api_key = document.getElementById('setting-api-key').value.trim();
  const webhook_url = document.getElementById('setting-webhook-url').value.trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ api_key, webhook_url, session_id: currentSessionId })
    });

    const data = await res.json();
    if (data.status) {
      currentApiKey = api_key;
      currentWebhookUrl = webhook_url;
      localStorage.setItem('wa_api_key', api_key);
      showToast('Pengaturan berhasil disimpan!', 'success');
    } else {
      showToast('Gagal menyimpan: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'wagateway_';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  document.getElementById('setting-api-key').value = result;
  showToast('API Key baru di-generate. Klik "Simpan Pengaturan" untuk menerapkan.', 'info');
}

// Toast Helper
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.innerText = message;

  if (type === 'success') {
    toast.className = 'fixed bottom-5 right-5 px-5 py-3 rounded-xl shadow-2xl text-white text-sm font-semibold transition-all duration-300 z-50 bg-emerald-600';
  } else if (type === 'error') {
    toast.className = 'fixed bottom-5 right-5 px-5 py-3 rounded-xl shadow-2xl text-white text-sm font-semibold transition-all duration-300 z-50 bg-red-600';
  } else {
    toast.className = 'fixed bottom-5 right-5 px-5 py-3 rounded-xl shadow-2xl text-white text-sm font-semibold transition-all duration-300 z-50 bg-blue-600';
  }

  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ================= USER MANAGEMENT & AUTH =================
let currentUser = null;

async function checkAuth() {
  const token = localStorage.getItem('wa_token');
  if (!token) {
    window.location.replace('/login.html');
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();

    if (data.status && data.user) {
      currentUser = data.user;
      document.getElementById('nav-username').innerText = data.user.name || data.user.username;
      const roleEl = document.getElementById('nav-user-role');
      if (roleEl) {
        roleEl.innerText = data.user.role;
        roleEl.className = data.user.role === 'admin'
          ? 'px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : 'px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30';
      }
    } else {
      localStorage.removeItem('wa_token');
      localStorage.removeItem('wa_user');
      window.location.replace('/login.html');
    }
  } catch (err) {
    // If offline or error, let local token proceed
  }
}

async function handleLogout() {
  if (!confirm('Apakah Anda yakin ingin keluar (logout) dari dashboard?')) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}

  localStorage.removeItem('wa_token');
  localStorage.removeItem('wa_user');
  window.location.replace('/login.html');
}

// User List CRUD
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  const token = localStorage.getItem('wa_token');

  try {
    const res = await fetch('/api/users', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const result = await res.json();

    if (!result.status) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-red-400">${result.message}</td></tr>`;
      return;
    }

    const users = result.data;
    if (!users || users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-gray-500">Tidak ada data pengguna.</td></tr>`;
      return;
    }

    let html = '';
    users.forEach(u => {
      const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID') : '-';
      const roleBadge = u.role === 'admin'
        ? '<span class="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold uppercase">Admin</span>'
        : '<span class="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold uppercase">Operator</span>';

      const userJson = JSON.stringify(u).replace(/"/g, '&quot;');

      html += `
        <tr class="hover:bg-gray-700/30 transition">
          <td class="px-4 py-3 font-mono text-xs text-gray-400">${u.id}</td>
          <td class="px-4 py-3 font-semibold text-white">${escapeHtml(u.name)}</td>
          <td class="px-4 py-3 font-mono text-gray-300">@${escapeHtml(u.username)}</td>
          <td class="px-4 py-3">${roleBadge}</td>
          <td class="px-4 py-3 text-xs text-gray-400">${dateStr}</td>
          <td class="px-4 py-3 text-center">
            <div class="inline-flex space-x-2">
              <button onclick='openModalEditUser(${userJson})' class="p-1.5 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg text-xs transition" title="Edit Pengguna">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="handleDeleteUser(${u.id}, '${escapeHtml(u.username)}')" class="p-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-xs transition" title="Hapus Pengguna">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-red-400">Error: ${err.message}</td></tr>`;
  }
}

// Add User Modal Handlers
function openModalAddUser() {
  document.getElementById('form-add-user').reset();
  document.getElementById('modal-add-user').classList.remove('hidden');
}

function closeModalAddUser() {
  document.getElementById('modal-add-user').classList.add('hidden');
}

async function handleAddUser(e) {
  e.preventDefault();
  const name = document.getElementById('add-user-name').value.trim();
  const username = document.getElementById('add-user-username').value.trim();
  const password = document.getElementById('add-user-password').value;
  const role = document.getElementById('add-user-role').value;
  const btn = document.getElementById('btn-save-new-user');
  const token = localStorage.getItem('wa_token');

  btn.disabled = true;
  btn.innerText = 'Menyimpan...';

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ name, username, password, role })
    });

    const data = await res.json();
    if (data.status) {
      showToast('Pengguna baru berhasil ditambahkan!', 'success');
      closeModalAddUser();
      loadUsers();
    } else {
      showToast('Gagal: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Simpan';
  }
}

// Edit User Modal Handlers
function openModalEditUser(user) {
  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-name').value = user.name;
  document.getElementById('edit-user-password').value = '';
  document.getElementById('edit-user-role').value = user.role;
  document.getElementById('modal-edit-user').classList.remove('hidden');
}

function closeModalEditUser() {
  document.getElementById('modal-edit-user').classList.add('hidden');
}

async function handleSaveEditUser(e) {
  e.preventDefault();
  const id = document.getElementById('edit-user-id').value;
  const name = document.getElementById('edit-user-name').value.trim();
  const password = document.getElementById('edit-user-password').value;
  const role = document.getElementById('edit-user-role').value;
  const btn = document.getElementById('btn-save-edit-user');
  const token = localStorage.getItem('wa_token');

  btn.disabled = true;
  btn.innerText = 'Mengupdate...';

  const bodyData = { name, role };
  if (password && password.trim() !== '') {
    bodyData.password = password;
  }

  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    if (data.status) {
      showToast('Data pengguna berhasil diperbarui!', 'success');
      closeModalEditUser();
      loadUsers();
    } else {
      showToast('Gagal: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Update';
  }
}

async function handleDeleteUser(id, username) {
  if (!confirm(`Apakah Anda yakin ingin menghapus akun "${username}"?`)) return;
  const token = localStorage.getItem('wa_token');

  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    const data = await res.json();
    if (data.status) {
      showToast('Pengguna berhasil dihapus!', 'success');
      loadUsers();
    } else {
      showToast('Gagal menghapus: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadSettings();
  loadSessions();
  checkStatus();

  // Periodic status refresh every 4 seconds as fallback
  setInterval(checkStatus, 4000);
});
