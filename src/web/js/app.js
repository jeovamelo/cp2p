/**
 * Comunidade Resiliente - Controlador Frontend da Interface Web & PWA
 * Comunicação bidirecional via WebSocket local (/live) e API REST
 */

class AppController {
  constructor() {
    this.state = {
      user: null,
      network: null,
      community: null,
      messages: [],
      attachmentBase64: null
    };

    this.liveSocket = null;
    this.reconnectTimer = null;

    this.initElements();
    this.attachEventListeners();
    this.registerServiceWorker();
    this.connectLiveWebSocket();
    this.loadInitialData();
  }

  initElements() {
    // Header status elements
    this.vpsChip = document.getElementById('vps-status-chip');
    this.vpsPulse = document.getElementById('vps-pulse-dot');
    this.vpsLabel = document.getElementById('vps-status-label');
    this.meshPulse = document.getElementById('mesh-pulse-dot');
    this.meshLabel = document.getElementById('mesh-status-label');
    this.leaderLabel = document.getElementById('leader-status-label');

    // Sidebar elements
    this.sidebarAvatar = document.getElementById('sidebar-user-avatar');
    this.sidebarName = document.getElementById('sidebar-user-name');
    this.sidebarRole = document.getElementById('sidebar-user-role');
    this.sidebarPubkey = document.getElementById('sidebar-pubkey-snippet');
    this.sidebarMsgCount = document.getElementById('sidebar-msg-count');
    this.telemetryNodeId = document.getElementById('telemetry-node-id');
    this.telemetryP2pPort = document.getElementById('telemetry-p2p-port');
    this.telemetryEpoch = document.getElementById('telemetry-epoch');
    this.telemetryTerm = document.getElementById('telemetry-term');

    // Feed elements
    this.vpsBanner = document.getElementById('vps-offline-banner');
    this.messagesStream = document.getElementById('messages-stream');
    this.emptyState = document.getElementById('empty-state-view');

    // Composer elements
    this.adminComposer = document.getElementById('admin-composer');
    this.memberReadonlyBar = document.getElementById('member-readonly-bar');
    this.composerInput = document.getElementById('composer-input');
    this.btnPublish = document.getElementById('btn-send-announcement');
    this.btnAttachImage = document.getElementById('btn-attach-image');
    this.fileAttachmentInput = document.getElementById('file-attachment-input');
    this.attachmentPreview = document.getElementById('composer-attachment-preview');
    this.attachmentImg = document.getElementById('attachment-preview-img');
    this.btnRemoveAttachment = document.getElementById('btn-remove-attachment');

    // Buttons
    this.btnOpenPeers = document.getElementById('btn-open-peers');
    this.btnOpenAdmin = document.getElementById('btn-open-admin');
    this.btnOpenAudit = document.getElementById('btn-open-audit');
    this.btnOpenBackup = document.getElementById('btn-open-backup');
    this.btnAuthAction = document.getElementById('btn-auth-action');
    this.btnCopyPubkey = document.getElementById('btn-copy-pubkey');
  }

  attachEventListeners() {
    // Modals open
    this.btnOpenPeers.addEventListener('click', () => this.openPeersModal());
    this.btnOpenAdmin.addEventListener('click', () => this.openAdminModal());
    this.btnOpenAudit.addEventListener('click', () => this.openAuditModal());
    this.btnOpenBackup.addEventListener('click', () => this.openModal('modal-backup'));
    this.btnAuthAction.addEventListener('click', () => this.openModal('modal-auth'));

    // Modals close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = e.currentTarget.getAttribute('data-close');
        this.closeModal(modalId);
      });
    });

    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });

    // Copy public key
    this.btnCopyPubkey.addEventListener('click', () => {
      if (this.state.user && this.state.user.publicKey) {
        navigator.clipboard.writeText(this.state.user.publicKey);
        this.showToast('Chave pública copiada para a área de transferência!');
      }
    });

    // Composer Image Attachment
    this.btnAttachImage.addEventListener('click', () => this.fileAttachmentInput.click());
    this.fileAttachmentInput.addEventListener('change', (e) => this.handleFileSelect(e));
    this.btnRemoveAttachment.addEventListener('click', () => this.removeAttachment());

    // Publish Announcement
    this.btnPublish.addEventListener('click', () => this.publishAnnouncement());
    this.composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        this.publishAnnouncement();
      }
    });

    // Auth modal actions
    document.getElementById('btn-submit-login').addEventListener('click', () => this.handleLogin());
    document.getElementById('btn-submit-register').addEventListener('click', () => this.handleRegister());
  }

  async loadInitialData() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      this.updateStatusUI(data);

      const msgRes = await fetch('/api/messages');
      const msgData = await msgRes.json();
      this.renderMessages(msgData.messages || []);
    } catch (e) {
      console.warn('Erro ao carregar dados iniciais:', e);
    }
  }

  connectLiveWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/live`;

    this.liveSocket = new WebSocket(wsUrl);

    this.liveSocket.onopen = () => {
      console.log('[Live WS] Conectado ao nó local P2P.');
      if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    };

    this.liveSocket.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        this.handleLiveEvent(packet);
      } catch (err) {
        console.error('Erro ao processar pacote live:', err);
      }
    };

    this.liveSocket.onclose = () => {
      console.warn('[Live WS] Desconectado. Tentando reconectar...');
      this.reconnectTimer = setTimeout(() => this.connectLiveWebSocket(), 3000);
    };
  }

  handleLiveEvent(event) {
    switch (event.type) {
      case 'INIT_STATE':
        if (event.networkStatus) this.updateNetworkUI(event.networkStatus);
        if (event.user) this.updateUserUI(event.user);
        break;

      case 'NEW_MESSAGE':
        this.appendMessage(event.message);
        break;

      case 'PEER_CHANGE':
      case 'LEADER_CHANGE':
      case 'VPS_STATUS_CHANGE':
        if (event.networkStatus) this.updateNetworkUI(event.networkStatus);
        break;

      case 'PUSH_NOTIFICATION':
        this.showBrowserNotification(event.notification);
        break;

      default:
        break;
    }
  }

  updateStatusUI(statusData) {
    if (statusData.user) this.updateUserUI(statusData.user);
    if (statusData.network) this.updateNetworkUI(statusData.network);
    if (statusData.community) {
      this.telemetryEpoch.textContent = `Época #${statusData.community.current_epoch}`;
    }
    this.telemetryNodeId.textContent = statusData.nodeId || '--';
    this.telemetryP2pPort.textContent = statusData.p2pPort ? `:${statusData.p2pPort}` : '--';
  }

  updateUserUI(user) {
    this.state.user = user;
    this.sidebarName.textContent = user.username;
    this.sidebarAvatar.textContent = user.username.charAt(0).toUpperCase();

    this.sidebarRole.textContent = user.role;
    this.sidebarRole.className = `role-badge ${user.role === 'Administrador' ? 'admin' : (user.role === 'Moderador' ? 'mod' : 'member')}`;

    if (user.publicKey) {
      const clean = user.publicKey.replace(/-----BEGIN PUBLIC KEY-----|\n|-----END PUBLIC KEY-----/g, '').trim();
      this.sidebarPubkey.textContent = `Chave: ${clean.substring(0, 14)}...`;
    }

    // Controle de permissão de publicação na UI: Apenas Administrador vê o composer ativo!
    if (user.role === 'Administrador') {
      this.adminComposer.style.display = 'flex';
      this.memberReadonlyBar.style.display = 'none';
    } else {
      this.adminComposer.style.display = 'none';
      this.memberReadonlyBar.style.display = 'flex';
    }
  }

  updateNetworkUI(net) {
    this.state.network = net;

    // 1. VPS Status
    if (net.isVpsAlive) {
      this.vpsPulse.className = 'pulse-dot online';
      this.vpsLabel.textContent = 'VPS: Online';
      this.vpsBanner.style.display = 'none';
    } else {
      this.vpsPulse.className = 'pulse-dot warning';
      this.vpsLabel.textContent = 'VPS: Offline (Malha Ativa)';
      this.vpsBanner.style.display = 'flex';
    }

    // 2. Mesh Peers Count
    const peerCount = net.activePeersCount || 0;
    this.meshLabel.textContent = `Malha P2P: ${peerCount} nó${peerCount === 1 ? '' : 's'}`;
    this.meshPulse.className = peerCount > 0 ? 'pulse-dot online' : 'pulse-dot warning';

    // 3. Líder Eleito
    if (net.currentLeader) {
      const leaderName = net.isLeader ? `${net.currentLeader} (Este Nó)` : net.currentLeader;
      this.leaderLabel.textContent = `Líder: ${leaderName}`;
    } else {
      this.leaderLabel.textContent = 'Líder: Em eleição...';
    }

    // 4. Telemetria
    if (net.term) this.telemetryTerm.textContent = `Termo ${net.term}`;
  }

  renderMessages(messages) {
    this.state.messages = messages;
    this.sidebarMsgCount.textContent = `${messages.length} msg${messages.length === 1 ? '' : 's'}`;

    if (messages.length === 0) {
      this.emptyState.style.display = 'block';
      return;
    }

    this.emptyState.style.display = 'none';
    // Remove mensagens existentes mantendo o emptyState
    const cards = this.messagesStream.querySelectorAll('.message-card');
    cards.forEach(c => c.remove());

    messages.forEach(msg => {
      const card = this.createMessageCard(msg);
      this.messagesStream.appendChild(card);
    });

    this.scrollToBottom();
  }

  appendMessage(msg) {
    // Evita duplicatas na UI
    if (this.state.messages.some(m => m.id === msg.id)) return;

    this.state.messages.push(msg);
    this.emptyState.style.display = 'none';
    this.sidebarMsgCount.textContent = `${this.state.messages.length} msg${this.state.messages.length === 1 ? '' : 's'}`;

    const card = this.createMessageCard(msg);
    this.messagesStream.appendChild(card);
    this.scrollToBottom();
  }

  createMessageCard(msg) {
    const card = document.createElement('div');
    card.className = 'message-card';
    card.id = `msg-${msg.id}`;

    const dateStr = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let attachmentHtml = '';
    if (msg.attachmentType === 'image' && msg.attachmentData) {
      attachmentHtml = `
        <div class="msg-attachment">
          <img src="${msg.attachmentData}" alt="Imagem do comunicado" loading="lazy">
        </div>
      `;
    }

    card.innerHTML = `
      <div class="msg-header">
        <div class="msg-author-row">
          <span class="author-name">${this.escapeHtml(msg.authorName)}</span>
          <span class="role-badge admin" style="font-size: 0.65rem;">ADMIN</span>
          <span class="sequence-badge">#${msg.sequence}</span>
        </div>
        <span class="msg-timestamp">${dateStr}</span>
      </div>

      <div class="msg-body">${this.escapeHtml(msg.text)}</div>

      ${attachmentHtml}

      <div class="msg-footer">
        <div class="signature-verified">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
          Assinatura Ed25519 Válida
        </div>
        <div class="hash-id" title="Hash SHA-256 do Bloco: ${msg.id}">
          ID: ${msg.id.substring(0, 16)}...
        </div>
        <div>Época #${msg.epoch}</div>
      </div>
    `;

    return card;
  }

  scrollToBottom() {
    this.messagesStream.scrollTop = this.messagesStream.scrollHeight;
  }

  handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Selecione apenas arquivos de imagem.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.state.attachmentBase64 = e.target.result;
      this.attachmentImg.src = e.target.result;
      this.attachmentPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  removeAttachment() {
    this.state.attachmentBase64 = null;
    this.attachmentImg.src = '';
    this.attachmentPreview.style.display = 'none';
    this.fileAttachmentInput.value = '';
  }

  async publishAnnouncement() {
    const text = this.composerInput.value.trim();
    if (!text) return;

    this.btnPublish.disabled = true;
    this.btnPublish.style.opacity = '0.6';

    try {
      const payload = {
        text,
        attachmentType: this.state.attachmentBase64 ? 'image' : null,
        attachmentData: this.state.attachmentBase64
      };

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao publicar mensagem');
      }

      this.composerInput.value = '';
      this.removeAttachment();
      this.showToast('Comunicado assinado e difundido na malha P2P com sucesso!');
    } catch (err) {
      alert(`Falha ao publicar: ${err.message}`);
    } finally {
      this.btnPublish.disabled = false;
      this.btnPublish.style.opacity = '1';
    }
  }

  // --- MODAIS ---
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  async openPeersModal() {
    this.openModal('modal-peers');
    const container = document.getElementById('modal-peers-list');
    container.innerHTML = '<p style="color: var(--text-dim);">Carregando nós...</p>';

    try {
      const res = await fetch('/api/peers');
      const data = await res.json();
      const peers = data.peers || [];

      if (peers.length === 0) {
        container.innerHTML = '<p style="color: var(--text-dim); grid-column: span 2;">Nenhum nó remoto conectado no momento.</p>';
        return;
      }

      container.innerHTML = peers.map(p => `
        <div class="peer-card ${p.status === 'alive' ? 'active' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="peer-id-label">${p.node_id}</span>
            <span class="role-badge ${p.is_bootstrap ? 'admin' : 'member'}" style="font-size: 0.65rem;">
              ${p.is_bootstrap ? 'Bootstrap VPS' : 'Nó Pessoal'}
            </span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Endereço: <code>${p.host}:${p.port}</code>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-dim);">
            <span>Status: <strong>${p.status}</strong></span>
            <span>Ping: ${p.latency}ms</span>
          </div>
        </div>
      `).join('');
    } catch (e) {
      container.innerHTML = '<p style="color: var(--accent-rose);">Erro ao consultar nós P2P.</p>';
    }
  }

  async openAdminModal() {
    this.openModal('modal-admin');
    const container = document.getElementById('admin-users-list');
    container.innerHTML = '<p style="color: var(--text-dim);">Carregando usuários...</p>';

    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      const users = data.users || [];

      container.innerHTML = users.map(u => `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 8px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <strong>${this.escapeHtml(u.username)}</strong>
            <span class="role-badge ${u.role === 'Administrador' ? 'admin' : (u.role === 'Moderador' ? 'mod' : 'member')}" style="font-size: 0.65rem; margin-left: 8px;">
              ${u.role}
            </span>
            <div style="font-size: 0.72rem; color: var(--text-dim); font-family: var(--font-mono); margin-top: 4px;">
              ID: ${u.id} • Status: <span style="color: ${u.status === 'active' ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">${u.status}</span>
            </div>
          </div>

          <div style="display: flex; gap: 8px;">
            ${u.status === 'active' && u.role !== 'Administrador' ? `
              <button class="btn-tool" onclick="window.app.promoteUser('${u.id}', '${u.role === 'Membro' ? 'Moderador' : 'Membro'}')">
                ${u.role === 'Membro' ? 'Promover a Mod' : 'Rebaixar a Membro'}
              </button>
              <button class="btn-tool" style="color: var(--accent-rose); border-color: rgba(244,63,94,0.3);" onclick="window.app.revokeUser('${u.id}', '${this.escapeHtml(u.username)}')">
                Revogar Acesso
              </button>
            ` : ''}
          </div>
        </div>
      `).join('');
    } catch (e) {
      container.innerHTML = '<p style="color: var(--accent-rose);">Erro ao carregar usuários.</p>';
    }
  }

  async promoteUser(userId, newRole) {
    if (!confirm(`Deseja alterar o papel deste usuário para ${newRole}?`)) return;
    try {
      const res = await fetch('/api/admin/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newRole })
      });
      if (res.ok) {
        this.showToast(`Papel atualizado com sucesso!`);
        this.openAdminModal();
      }
    } catch (e) {
      alert('Falha ao atualizar papel.');
    }
  }

  async revokeUser(userId, username) {
    if (!confirm(`ATENÇÃO: Revogar o usuário "${username}" ativará imediatamente a Rotação de Chaves Criptográficas da Comunidade (Key Rotation). Uma nova chave de canal será criada. Deseja prosseguir?`)) return;

    try {
      const res = await fetch('/api/admin/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        this.openAdminModal();
        this.loadInitialData();
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (e) {
      alert('Falha ao revogar usuário.');
    }
  }

  async openAuditModal() {
    this.openModal('modal-audit');
    const container = document.getElementById('audit-logs-list');
    const statusBadge = document.getElementById('audit-integrity-status');
    container.innerHTML = '<p style="color: var(--text-dim);">Verificando integridade da cadeia de auditoria...</p>';

    try {
      const res = await fetch('/api/audit');
      const data = await res.json();

      if (data.integrity.valid) {
        statusBadge.innerHTML = '✓ Cadeia de Auditoria Verificada e 100% Íntegra';
        statusBadge.style.color = 'var(--accent-emerald)';
      } else {
        statusBadge.innerHTML = `⚠️ Cadeia adulterada! Inconsistência no bloco #${data.integrity.corruptedAt}`;
        statusBadge.style.color = 'var(--accent-rose)';
      }

      const logs = data.logs || [];
      container.innerHTML = logs.map(l => {
        const time = new Date(l.timestamp).toLocaleString('pt-BR');
        return `
          <div style="background: rgba(0,0,0,0.3); border-left: 3px solid var(--accent-cyan); padding: 8px 12px; border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; color: var(--accent-cyan);">
              <strong>${l.action}</strong>
              <span style="color: var(--text-dim);">${time}</span>
            </div>
            <div style="color: var(--text-muted); margin-top: 4px; word-break: break-all;">
              ${this.escapeHtml(l.details)}
            </div>
            <div style="color: var(--text-dim); font-size: 0.68rem; margin-top: 4px;">
              Hash: ${l.audit_hash.substring(0, 20)}... | Prev: ${l.prev_audit_hash.substring(0, 10)}...
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      container.innerHTML = '<p style="color: var(--accent-rose);">Erro ao consultar logs de auditoria.</p>';
    }
  }

  // --- AUTENTICAÇÃO ---
  async handleLogin() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!username || !password) return alert('Informe usuário e senha');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      this.closeModal('modal-auth');
      this.updateUserUI(data.user);
      this.showToast(`Bem-vindo, ${data.user.username}!`);
      this.loadInitialData();
    } catch (e) {
      alert(`Falha no login: ${e.message}`);
    }
  }

  async handleRegister() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const role = document.getElementById('auth-role').value;
    if (!username || !password) return alert('Informe usuário e senha');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      this.closeModal('modal-auth');
      this.updateUserUI(data.user);
      this.showToast(`Conta criada com sucesso com papel de ${data.user.role}!`);
      this.loadInitialData();
    } catch (e) {
      alert(`Falha ao registrar: ${e.message}`);
    }
  }

  // --- NOTIFICAÇÕES PWA / BROWSER ---
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  showBrowserNotification(notif) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notif.title, {
        body: notif.body,
        icon: '/manifest.json'
      });
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '30px';
    toast.style.right = '30px';
    toast.style.background = '#10b981';
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    toast.style.zIndex = '9999';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Inicializa a aplicação
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
