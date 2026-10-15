/**
 * Comunidade Resiliente - Controlador Frontend da Interface WhatsApp Desktop P2P
 * Layout de 3 colunas aos moldes do WhatsApp Desktop / Comunidades:
 * - Coluna 1: Dock Lateral de Comunidades (Criar, Entrar via Convite, Alternar)
 * - Coluna 2: Canais & Chats da Comunidade (Avisos Oficiais, Discussão, Topologia)
 * - Coluna 3: Chat estilo WhatsApp (Bolhas verdes, Assinaturas Ed25519, Duplo Check ✓✓)
 */

class AppController {
  constructor() {
    this.state = {
      user: null,
      network: null,
      communities: [],
      activeCommunityId: 'geral',
      activeChannel: 'announcements',
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
    // Dock / Rail de Comunidades
    this.communitiesContainer = document.getElementById('wa-communities-container');
    this.btnOpenCreateComm = document.getElementById('btn-open-create-comm');
    this.btnOpenJoinComm = document.getElementById('btn-open-join-comm');
    this.railMeshDot = document.getElementById('rail-mesh-dot');
    this.railUserAvatar = document.getElementById('rail-user-avatar');
    this.btnQuickStatus = document.getElementById('btn-quick-status');
    this.btnUserProfileQuick = document.getElementById('btn-user-profile-quick');

    // Sidebar de Canais & Chats
    this.activeCommName = document.getElementById('wa-active-comm-name');
    this.activeCommRole = document.getElementById('wa-active-comm-role');
    this.btnInviteActiveComm = document.getElementById('btn-invite-active-comm');
    this.btnCommMenu = document.getElementById('btn-comm-menu');
    this.searchInput = document.getElementById('wa-search-input');
    this.channelsList = document.getElementById('wa-channels-list');
    this.channelSnippet = document.getElementById('wa-snippet-text');
    this.channelLastTime = document.getElementById('wa-channel-last-time');
    this.msgCountBadge = document.getElementById('wa-msg-count-badge');
    this.meshCountLabel = document.getElementById('wa-mesh-count-label');

    // Sidebar Footer (Usuário Ativo)
    this.sidebarAvatar = document.getElementById('sidebar-user-avatar');
    this.sidebarName = document.getElementById('sidebar-user-name');
    this.sidebarRole = document.getElementById('sidebar-user-role');
    this.btnCopyPubkey = document.getElementById('btn-copy-pubkey');

    // Chat Header & Pane
    this.chatHeaderTitle = document.getElementById('chat-header-title');
    this.chatHeaderSubtitle = document.getElementById('chat-header-subtitle');
    this.chatHeaderAvatar = document.getElementById('chat-header-avatar');
    this.chatScroll = document.getElementById('wa-chat-scroll');
    this.messagesStream = document.getElementById('messages-stream');
    this.emptyState = document.getElementById('empty-state-view');
    this.vpsOfflineBanner = document.getElementById('vps-offline-banner');

    // Botões de Ação do Chat Header
    this.btnOpenPeers = document.getElementById('btn-open-peers');
    this.btnOpenAudit = document.getElementById('btn-open-audit');
    this.btnOpenBackup = document.getElementById('btn-open-backup');
    this.btnOpenAdmin = document.getElementById('btn-open-admin');
    this.btnAuthAction = document.getElementById('btn-auth-action');
    this.waPeersBtnLabel = document.getElementById('wa-peers-btn-label');

    // Composer
    this.adminComposer = document.getElementById('admin-composer');
    this.memberReadonlyBar = document.getElementById('member-readonly-bar');
    this.composerInput = document.getElementById('composer-input');
    this.btnPublish = document.getElementById('btn-send-announcement');
    this.btnAttachImage = document.getElementById('btn-attach-image');
    this.fileAttachmentInput = document.getElementById('file-attachment-input');
    this.attachmentPreview = document.getElementById('composer-attachment-preview');
    this.attachmentImg = document.getElementById('attachment-preview-img');
    this.btnRemoveAttachment = document.getElementById('btn-remove-attachment');

    // Modais & Ações
    this.btnSubmitCreateComm = document.getElementById('btn-submit-create-comm');
    this.newCommNameInput = document.getElementById('new-comm-name');
    this.newCommDescInput = document.getElementById('new-comm-desc');

    this.btnSubmitJoinComm = document.getElementById('btn-submit-join-comm');
    this.joinCommCodeInput = document.getElementById('join-comm-code');

    this.inviteCodeDisplay = document.getElementById('invite-code-display');
    this.btnCopyInviteCode = document.getElementById('btn-copy-invite-code');

    // Telemetria Modal
    this.vpsPulse = document.getElementById('vps-pulse-dot');
    this.vpsLabel = document.getElementById('vps-status-label');
    this.meshPulse = document.getElementById('mesh-pulse-dot');
    this.meshLabel = document.getElementById('mesh-status-label');
    this.leaderLabel = document.getElementById('leader-status-label');
  }

  attachEventListeners() {
    // Abrir Modais de Comunidade
    this.btnOpenCreateComm.addEventListener('click', () => this.openModal('modal-create-comm'));
    this.btnOpenJoinComm.addEventListener('click', () => this.openModal('modal-join-comm'));
    this.btnInviteActiveComm.addEventListener('click', () => this.openInviteModalForActive());

    // Botões de Criar e Entrar
    this.btnSubmitCreateComm.addEventListener('click', () => this.handleCreateCommunity());
    this.btnSubmitJoinComm.addEventListener('click', () => this.handleJoinCommunity());
    this.btnCopyInviteCode.addEventListener('click', () => this.copyInviteCodeToClipboard());

    // Modais do Chat Header
    this.btnOpenPeers.addEventListener('click', () => this.openPeersModal());
    this.btnOpenAudit.addEventListener('click', () => this.openAuditModal());
    this.btnOpenBackup.addEventListener('click', () => this.openModal('modal-backup'));
    this.btnOpenAdmin.addEventListener('click', () => this.openAdminModal());
    this.btnAuthAction.addEventListener('click', () => this.openModal('modal-auth'));
    this.btnQuickStatus.addEventListener('click', () => this.openPeersModal());
    this.btnUserProfileQuick.addEventListener('click', () => this.openModal('modal-auth'));

    // Fechar Modais
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = e.currentTarget.getAttribute('data-close');
        this.closeModal(modalId);
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });

    // Copiar chave pública
    this.btnCopyPubkey.addEventListener('click', () => {
      if (this.state.user && this.state.user.publicKey) {
        navigator.clipboard.writeText(this.state.user.publicKey);
        this.showToast('Chave pública copiada com sucesso!');
      }
    });

    // Anexo de Imagem
    this.btnAttachImage.addEventListener('click', () => this.fileAttachmentInput.click());
    this.fileAttachmentInput.addEventListener('change', (e) => this.handleFileSelect(e));
    this.btnRemoveAttachment.addEventListener('click', () => this.removeAttachment());

    // Publicação de Comunicado
    this.btnPublish.addEventListener('click', () => this.publishAnnouncement());
    this.composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.publishAnnouncement();
      }
    });

    // Pesquisa em Tempo Real
    this.searchInput.addEventListener('input', (e) => this.filterMessagesByQuery(e.target.value));

    // Abas de Filtro
    document.querySelectorAll('.wa-filter-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.wa-filter-chip').forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const filter = e.currentTarget.getAttribute('data-filter');
        this.applyCategoryFilter(filter);
      });
    });

    // Canais da Sidebar
    document.querySelectorAll('.wa-channel-item').forEach(item => {
      item.addEventListener('click', (e) => {
        document.querySelectorAll('.wa-channel-item').forEach(c => c.classList.remove('active'));
        const el = e.currentTarget;
        el.classList.add('active');
        const channelType = el.getAttribute('data-channel');
        this.switchChannel(channelType);
      });
    });

    // Auth modal actions
    document.getElementById('btn-submit-login').addEventListener('click', () => this.handleLogin());
    document.getElementById('btn-submit-register').addEventListener('click', () => this.handleRegister());
  }

  async loadInitialData() {
    try {
      // 1. Status Geral e Usuário
      const res = await fetch('/api/status');
      const data = await res.json();
      this.updateStatusUI(data);

      // 2. Carrega Lista de Comunidades
      await this.loadCommunities();

      // 3. Carrega Mensagens da Comunidade Ativa
      await this.loadMessages(this.state.activeCommunityId);
    } catch (e) {
      console.warn('Erro ao carregar dados iniciais:', e);
    }
  }

  async loadCommunities() {
    try {
      const res = await fetch('/api/communities');
      const data = await res.json();
      this.state.communities = data.communities || [];

      if (this.state.communities.length > 0) {
        const found = this.state.communities.find(c => c.id === this.state.activeCommunityId);
        if (!found) {
          this.state.activeCommunityId = this.state.communities[0].id;
        }
      }

      this.renderCommunitiesRail();
      this.updateActiveCommunityHeader();
    } catch (e) {
      console.error('Erro ao carregar comunidades:', e);
    }
  }

  renderCommunitiesRail() {
    this.communitiesContainer.innerHTML = '';

    this.state.communities.forEach(comm => {
      const circle = document.createElement('div');
      circle.className = `wa-comm-circle ${comm.id === this.state.activeCommunityId ? 'active' : ''}`;
      circle.setAttribute('title', comm.name);

      // Iniciais da comunidade (máximo 2 letras)
      const words = comm.name.trim().split(/\s+/);
      const initials = words.length >= 2 
        ? (words[0][0] + words[1][0]).toUpperCase()
        : comm.name.slice(0, 2).toUpperCase();

      circle.textContent = initials;

      circle.addEventListener('click', () => {
        if (this.state.activeCommunityId !== comm.id) {
          this.switchCommunity(comm.id);
        }
      });

      this.communitiesContainer.appendChild(circle);
    });
  }

  switchCommunity(communityId) {
    this.state.activeCommunityId = communityId;
    this.renderCommunitiesRail();
    this.updateActiveCommunityHeader();
    this.loadMessages(communityId);
  }

  updateActiveCommunityHeader() {
    const active = this.state.communities.find(c => c.id === this.state.activeCommunityId);
    if (!active) return;

    this.activeCommName.textContent = active.name;
    this.activeCommRole.textContent = active.isAdmin ? 'Administrador' : 'Membro';

    if (this.state.activeChannel === 'announcements') {
      this.chatHeaderTitle.textContent = `Avisos Oficiais • ${active.name}`;
      this.chatHeaderSubtitle.textContent = active.description || 'Canal oficial • Apenas administradores podem publicar • E2EE P2P';
    }

    this.updateComposerPermissions(active);
  }

  updateComposerPermissions(activeComm) {
    const isAdmin = activeComm ? activeComm.isAdmin : (this.state.user && this.state.user.role === 'Administrador');

    if (isAdmin) {
      this.adminComposer.style.display = 'flex';
      this.memberReadonlyBar.style.display = 'none';
    } else {
      this.adminComposer.style.display = 'none';
      this.memberReadonlyBar.style.display = 'flex';
    }
  }

  async loadMessages(communityId) {
    try {
      const res = await fetch(`/api/messages?communityId=${encodeURIComponent(communityId)}`);
      const data = await res.json();
      this.renderMessages(data.messages || []);
    } catch (e) {
      console.error('Erro ao carregar mensagens da comunidade:', e);
    }
  }

  switchChannel(channelType) {
    this.state.activeChannel = channelType;
    const activeComm = this.state.communities.find(c => c.id === this.state.activeCommunityId);
    const commName = activeComm ? activeComm.name : 'Comunidade';

    if (channelType === 'announcements') {
      this.chatHeaderAvatar.textContent = '📢';
      this.chatHeaderTitle.textContent = `Avisos Oficiais • ${commName}`;
      this.chatHeaderSubtitle.textContent = 'somente administradores podem publicar • E2EE P2P';
      this.updateComposerPermissions(activeComm);
      this.loadMessages(this.state.activeCommunityId);
    } else if (channelType === 'discussion') {
      this.chatHeaderAvatar.textContent = '💬';
      this.chatHeaderTitle.textContent = `Discussão da Comunidade • ${commName}`;
      this.chatHeaderSubtitle.textContent = 'Espaço aberto de troca e suporte mútuo entre membros';
      this.adminComposer.style.display = 'none';
      this.memberReadonlyBar.style.display = 'flex';
      this.memberReadonlyBar.querySelector('span').textContent = 'Canal de Discussão aberto: use para interagir com a comunidade.';
    } else if (channelType === 'network') {
      this.openPeersModal();
    }
  }

  // --- CRIAÇÃO E CONVITES DE COMUNIDADE ---
  async handleCreateCommunity() {
    const name = this.newCommNameInput.value.trim();
    const description = this.newCommDescInput.value.trim();

    if (!name) {
      alert('Digite o nome da comunidade.');
      return;
    }

    try {
      const res = await fetch('/api/communities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Erro ao criar comunidade.');
        return;
      }

      this.closeModal('modal-create-comm');
      this.newCommNameInput.value = '';
      this.newCommDescInput.value = '';

      this.showToast(`Comunidade "${name}" criada com sucesso!`);

      await this.loadCommunities();
      this.switchCommunity(data.community.id);

      // Exibe imediatamente o código de convite para compartilhar
      this.inviteCodeDisplay.value = data.inviteCode;
      this.openModal('modal-invite-share');
    } catch (e) {
      alert('Erro de rede ao criar comunidade.');
    }
  }

  async handleJoinCommunity() {
    const inviteCode = this.joinCommCodeInput.value.trim();
    if (!inviteCode) {
      alert('Cole o código de convite da comunidade.');
      return;
    }

    try {
      const res = await fetch('/api/communities/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Erro ao entrar na comunidade.');
        return;
      }

      this.closeModal('modal-join-comm');
      this.joinCommCodeInput.value = '';

      this.showToast(data.message || 'Entrou na comunidade com sucesso!');

      await this.loadCommunities();
      this.switchCommunity(data.community.id);
    } catch (e) {
      alert('Erro de rede ao entrar na comunidade.');
    }
  }

  async openInviteModalForActive() {
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(this.state.activeCommunityId)}/invite`);
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Erro ao gerar convite.');
        return;
      }

      this.inviteCodeDisplay.value = data.inviteCode;
      this.openModal('modal-invite-share');
    } catch (e) {
      alert('Erro ao carregar código de convite.');
    }
  }

  copyInviteCodeToClipboard() {
    const code = this.inviteCodeDisplay.value;
    if (code) {
      navigator.clipboard.writeText(code);
      this.showToast('Código de convite copiado para a área de transferência!');
      this.btnCopyInviteCode.textContent = '✓ Copiado com Sucesso!';
      setTimeout(() => {
        this.btnCopyInviteCode.textContent = 'Copiar Código de Convite';
      }, 2500);
    }
  }

  // --- WEBSOCKET LIVE ---
  connectLiveWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/live`;

    this.liveSocket = new WebSocket(wsUrl);

    this.liveSocket.onopen = () => {
      console.log('[WhatsApp Desktop P2P] Conectado ao daemon local.');
      if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    };

    this.liveSocket.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        this.handleLiveEvent(packet);
      } catch (err) {
        console.error('Erro ao processar mensagem live:', err);
      }
    };

    this.liveSocket.onclose = () => {
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
        if (event.message.communityId === this.state.activeCommunityId) {
          this.appendMessage(event.message);
        }
        this.updateSidebarSnippet(event.message);
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
  }

  updateUserUI(user) {
    this.state.user = user;
    this.sidebarName.textContent = user.username;
    this.sidebarAvatar.textContent = user.username.charAt(0).toUpperCase();
    this.railUserAvatar.textContent = user.username.charAt(0).toUpperCase();

    this.sidebarRole.textContent = user.role;
    this.sidebarRole.className = `wa-footer-role ${user.role === 'Administrador' ? 'admin' : (user.role === 'Moderador' ? 'mod' : 'member')}`;

    const activeComm = this.state.communities.find(c => c.id === this.state.activeCommunityId);
    this.updateComposerPermissions(activeComm);
  }

  updateNetworkUI(net) {
    this.state.network = net;

    // VPS Status
    if (net.isVpsAlive) {
      this.railMeshDot.className = 'pulse-dot online';
      this.vpsOfflineBanner.style.display = 'none';
      if (this.vpsPulse) this.vpsPulse.className = 'pulse-dot online';
      if (this.vpsLabel) this.vpsLabel.textContent = 'VPS: Online';
    } else {
      this.railMeshDot.className = 'pulse-dot warning';
      this.vpsOfflineBanner.style.display = 'flex';
      if (this.vpsPulse) this.vpsPulse.className = 'pulse-dot warning';
      if (this.vpsLabel) this.vpsLabel.textContent = 'VPS: Offline (Malha Ativa)';
    }

    // Peers Count
    const peerCount = net.activePeersCount || 0;
    this.waPeersBtnLabel.textContent = `Nós P2P (${peerCount})`;
    this.meshCountLabel.textContent = `${peerCount} nós`;

    if (this.meshPulse) this.meshPulse.className = peerCount > 0 ? 'pulse-dot online' : 'pulse-dot warning';
    if (this.meshLabel) this.meshLabel.textContent = `Malha: ${peerCount} nó${peerCount === 1 ? '' : 's'}`;

    // Líder
    if (this.leaderLabel) {
      const leaderName = net.isLeader ? `${net.currentLeader} (Este Nó)` : (net.currentLeader || '--');
      this.leaderLabel.textContent = `Líder: ${leaderName}`;
    }
  }

  renderMessages(messages) {
    this.state.messages = messages;
    this.msgCountBadge.textContent = messages.length;

    if (messages.length === 0) {
      this.emptyState.style.display = 'block';
      const bubbles = this.messagesStream.querySelectorAll('.wa-bubble-message');
      bubbles.forEach(b => b.remove());
      return;
    }

    this.emptyState.style.display = 'none';
    const bubbles = this.messagesStream.querySelectorAll('.wa-bubble-message');
    bubbles.forEach(b => b.remove());

    messages.forEach(msg => {
      const bubble = this.createMessageBubble(msg);
      this.messagesStream.appendChild(bubble);
    });

    const last = messages[messages.length - 1];
    if (last) this.updateSidebarSnippet(last);

    this.scrollToBottom();
  }

  appendMessage(msg) {
    if (this.state.messages.some(m => m.id === msg.id)) return;

    this.state.messages.push(msg);
    this.emptyState.style.display = 'none';
    this.msgCountBadge.textContent = this.state.messages.length;

    const bubble = this.createMessageBubble(msg);
    this.messagesStream.appendChild(bubble);
    this.updateSidebarSnippet(msg);
    this.scrollToBottom();
  }

  createMessageBubble(msg) {
    const bubble = document.createElement('div');
    bubble.className = 'wa-bubble-message admin-announcement';
    bubble.id = `msg-${msg.id}`;

    const dateStr = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let attachmentHtml = '';
    if (msg.attachmentType === 'image' && msg.attachmentData) {
      attachmentHtml = `
        <div class="wa-bubble-attachment">
          <img src="${msg.attachmentData}" alt="Imagem do comunicado" loading="lazy">
        </div>
      `;
    }

    bubble.innerHTML = `
      <div class="wa-bubble-header">
        <span class="wa-bubble-author">
          ${this.escapeHtml(msg.authorName)}
          <span class="wa-badge-admin">ADMINISTRADOR</span>
          <span class="wa-badge-verified">✓ Ed25519</span>
        </span>
        <span class="wa-bubble-seq">#${msg.sequence}</span>
      </div>

      <div class="wa-bubble-text">${this.escapeHtml(msg.text)}</div>

      ${attachmentHtml}

      <div class="wa-bubble-footer">
        <span class="wa-bubble-time">${dateStr}</span>
        <span class="wa-bubble-checks" title="Verificado na rede P2P">✓✓</span>
      </div>
    `;

    return bubble;
  }

  updateSidebarSnippet(msg) {
    this.channelSnippet.textContent = msg.text.length > 40 ? msg.text.slice(0, 40) + '...' : msg.text;
    const timeStr = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    this.channelLastTime.textContent = timeStr;
  }

  scrollToBottom() {
    if (this.chatScroll) {
      this.chatScroll.scrollTop = this.chatScroll.scrollHeight;
    }
  }

  // --- COMPOSER ANEXO & PUBLICAÇÃO ---
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

    try {
      const payload = {
        communityId: this.state.activeCommunityId,
        text,
        attachmentType: this.state.attachmentBase64 ? 'image' : null,
        attachmentData: this.state.attachmentBase64 || null
      };

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Erro ao publicar comunicado.');
        return;
      }

      this.composerInput.value = '';
      this.removeAttachment();
      this.showToast('Comunicado assinado e replicado via P2P!');
    } catch (e) {
      alert('Erro de rede ao publicar comunicado.');
    } finally {
      this.btnPublish.disabled = false;
      this.composerInput.focus();
    }
  }

  filterMessagesByQuery(query) {
    const q = query.toLowerCase().trim();
    const bubbles = this.messagesStream.querySelectorAll('.wa-bubble-message');

    bubbles.forEach(b => {
      const text = b.textContent.toLowerCase();
      b.style.display = text.includes(q) ? 'block' : 'none';
    });
  }

  applyCategoryFilter(filter) {
    if (filter === 'all' || filter === 'announcements') {
      this.switchChannel('announcements');
    } else if (filter === 'peers') {
      this.openPeersModal();
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
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      const listEl = document.getElementById('modal-peers-list');
      listEl.innerHTML = '';

      const peers = (data.network && data.network.knownPeers) || [];
      if (peers.length === 0) {
        listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Nenhum nó vizinho descoberto ainda.</p>';
        return;
      }

      peers.forEach(p => {
        const item = document.createElement('div');
        item.className = 'peer-card';
        item.innerHTML = `
          <div>
            <div class="peer-id">${p.nodeId || `${p.host}:${p.port}`}</div>
            <div class="peer-meta">${p.host}:${p.port} • ${p.isBootstrap ? 'Bootstrap / VPS' : 'Nó Pessoal'}</div>
          </div>
          <span class="role-badge member">Conectado</span>
        `;
        listEl.appendChild(item);
      });
    } catch (e) {}
  }

  async openAdminModal() {
    this.openModal('modal-admin');
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      const listEl = document.getElementById('admin-users-list');
      listEl.innerHTML = '';

      (data.users || []).forEach(u => {
        const row = document.createElement('div');
        row.className = 'user-item-row';
        row.innerHTML = `
          <div>
            <div class="user-item-name">${this.escapeHtml(u.username)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${u.role} • ${u.status}</div>
          </div>
          <div class="user-item-actions">
            ${u.role !== 'Administrador' ? `<button class="btn-sm-action" onclick="app.updateRole('${u.id}', 'Administrador')">Promover a Admin</button>` : ''}
            ${u.status !== 'revoked' ? `<button class="btn-sm-action danger" onclick="app.revokeUser('${u.id}')">Revogar & Rotacionar Chave</button>` : ''}
          </div>
        `;
        listEl.appendChild(row);
      });
    } catch (e) {}
  }

  async updateRole(userId, newRole) {
    if (!confirm(`Confirma alterar papel do usuário para ${newRole}?`)) return;
    try {
      const res = await fetch('/api/admin/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newRole })
      });
      if (res.ok) {
        this.showToast('Papel alterado com sucesso!');
        this.openAdminModal();
      }
    } catch (e) {}
  }

  async revokeUser(userId) {
    if (!confirm('ATENÇÃO: Revogar o usuário gerará uma NOVA ÉPOCA CRIPTOGRÁFICA (Key Rotation). O membro revogado não poderá ler mensagens futuras. Deseja continuar?')) return;
    try {
      const res = await fetch('/api/admin/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (res.ok) {
        this.showToast(data.message || 'Membro revogado e chave rotacionada!');
        this.openAdminModal();
      }
    } catch (e) {}
  }

  async openAuditModal() {
    this.openModal('modal-audit');
    try {
      const res = await fetch('/api/audit');
      const data = await res.json();
      const listEl = document.getElementById('audit-logs-list');
      listEl.innerHTML = '';

      (data.logs || []).slice(0, 15).forEach(log => {
        const item = document.createElement('div');
        item.style.background = 'rgba(255,255,255,0.03)';
        item.style.padding = '8px 10px';
        item.style.borderRadius = '6px';
        item.innerHTML = `
          <div style="color: var(--wa-green); font-weight: 600;">${log.action}</div>
          <div style="color: var(--text-muted); font-size: 0.7rem;">${new Date(log.timestamp).toLocaleString()}</div>
          <div style="word-break: break-all; margin-top: 3px; color: #cbd5e1;">Hash: ${log.audit_hash}</div>
        `;
        listEl.appendChild(item);
      });
    } catch (e) {}
  }

  async handleLogin() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!username || !password) return alert('Preencha usuário e senha.');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Erro ao autenticar.');

      this.updateUserUI(data.user);
      this.closeModal('modal-auth');
      this.showToast(`Bem-vindo, ${data.user.username}!`);
      await this.loadCommunities();
    } catch (e) {
      alert('Erro de conexão ao autenticar.');
    }
  }

  async handleRegister() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const role = document.getElementById('auth-role').value;

    if (!username || !password) return alert('Preencha usuário e senha.');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });

      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Erro ao registrar.');

      this.updateUserUI(data.user);
      this.closeModal('modal-auth');
      this.showToast(`Conta criada com sucesso!`);
      await this.loadCommunities();
    } catch (e) {
      alert('Erro de conexão ao registrar.');
    }
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  showBrowserNotification(notif) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notif.title || 'Comunidade Resiliente', {
        body: notif.body || 'Novo comunicado oficial assinado.',
        icon: '/icons/icon-192.png'
      });
    }
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Inicializa a aplicação
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
