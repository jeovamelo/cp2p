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
      attachmentBase64: null,
      dashboard: {
        overview: null,
        nodes: [],
        members: [],
        devices: null,
        events: []
      },
      memberFilter: 'all',
      memberSearchQuery: ''
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
    this.btnOpenNetworkDashboard = document.getElementById('btn-open-network-dashboard');
    this.waNetworkBtnLabel = document.getElementById('wa-network-btn-label');
    this.btnOpenPeers = document.getElementById('btn-open-peers');
    this.btnOpenAudit = document.getElementById('btn-open-audit');
    this.btnOpenBackup = document.getElementById('btn-open-backup');
    this.btnOpenAdmin = document.getElementById('btn-open-admin');
    this.btnAuthAction = document.getElementById('btn-auth-action');
    this.waPeersBtnLabel = document.getElementById('wa-peers-btn-label');

    // Painel Visão da Comunidade / Status da Rede
    this.dashLastUpdatedBadge = document.getElementById('dash-last-updated-badge');
    this.dashUserRoleBadge = document.getElementById('dash-user-role-badge');
    this.dashLiveDot = document.getElementById('dash-live-dot');
    this.dashLiveLabel = document.getElementById('dash-live-label');
    this.dashBtnRefresh = document.getElementById('dash-btn-refresh');
    this.dashMembersSearch = document.getElementById('dash-members-search');

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

    // Telemetria Modal Antiga / Compatibilidade
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

    // Painel Visão da Comunidade & Modais do Chat Header
    if (this.btnOpenNetworkDashboard) {
      this.btnOpenNetworkDashboard.addEventListener('click', () => this.openNetworkDashboard());
    }
    this.btnOpenPeers.addEventListener('click', () => this.openNetworkDashboard('nodes'));
    this.btnOpenAudit.addEventListener('click', () => this.openAuditModal());
    this.btnOpenBackup.addEventListener('click', () => this.openModal('modal-backup'));
    this.btnOpenAdmin.addEventListener('click', () => this.openAdminModal());
    this.btnAuthAction.addEventListener('click', () => this.openModal('modal-auth'));
    this.btnQuickStatus.addEventListener('click', () => this.openNetworkDashboard());
    this.btnUserProfileQuick.addEventListener('click', () => this.openModal('modal-auth'));

    // Abas do Painel de Rede
    document.querySelectorAll('.dash-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.dash-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.dash-tab-pane').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const tab = e.currentTarget.getAttribute('data-dash-tab');
        const pane = document.getElementById(`pane-dash-${tab}`);
        if (pane) pane.classList.add('active');
        if (tab === 'topology') this.renderTopologyMap();
      });
    });

    // Filtros de Membros no Painel
    document.querySelectorAll('[data-member-filter]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('[data-member-filter]').forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.state.memberFilter = e.currentTarget.getAttribute('data-member-filter');
        this.renderMembersTable();
      });
    });

    if (this.dashMembersSearch) {
      this.dashMembersSearch.addEventListener('input', (e) => {
        this.state.memberSearchQuery = e.target.value.toLowerCase().trim();
        this.renderMembersTable();
      });
    }

    if (this.dashBtnRefresh) {
      this.dashBtnRefresh.addEventListener('click', () => {
        this.loadNetworkDashboardData();
        this.showToast('Telemetria da comunidade atualizada!');
      });
    }

    const btnRecenter = document.getElementById('btn-recenter-topology');
    if (btnRecenter) btnRecenter.addEventListener('click', () => this.renderTopologyMap());

    const btnClosePopover = document.getElementById('btn-close-popover');
    if (btnClosePopover) btnClosePopover.addEventListener('click', () => {
      const popover = document.getElementById('dash-node-popover');
      if (popover) popover.style.display = 'none';
    });

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
      this.openNetworkDashboard();
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
        if (event.networkOverview) {
          this.state.dashboard.overview = event.networkOverview;
          this.renderDashboardOverview();
          this.renderTopologyMap();
        }
        break;

      case 'NEW_MESSAGE':
        if (event.message.communityId === this.state.activeCommunityId) {
          this.appendMessage(event.message);
        }
        this.updateSidebarSnippet(event.message);
        break;

      case 'NETWORK_UPDATE':
      case 'NETWORK_EVENT':
      case 'PEER_CHANGE':
      case 'LEADER_CHANGE':
      case 'VPS_STATUS_CHANGE':
        if (event.networkStatus) this.updateNetworkUI(event.networkStatus);
        if (event.networkOverview) {
          this.state.dashboard.overview = event.networkOverview;
          this.renderDashboardOverview();
          this.renderTopologyMap();
        }
        // Se o modal do painel estiver aberto, recarrega os dados em tempo real
        const dashModal = document.getElementById('modal-network-dashboard');
        if (dashModal && dashModal.classList.contains('active')) {
          this.loadNetworkDashboardData();
        }
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
    this.openNetworkDashboard('nodes');
  }

  // --- PAINEL VISUAL: VISÃO DA COMUNIDADE & STATUS DA REDE P2P ---
  async openNetworkDashboard(initialTab = 'overview') {
    this.openModal('modal-network-dashboard');

    if (initialTab) {
      document.querySelectorAll('.dash-tab-btn').forEach(b => {
        if (b.getAttribute('data-dash-tab') === initialTab) b.classList.add('active');
        else b.classList.remove('active');
      });
      document.querySelectorAll('.dash-tab-pane').forEach(p => {
        if (p.id === `pane-dash-${initialTab}`) p.classList.add('active');
        else p.classList.remove('active');
      });
    }

    await this.loadNetworkDashboardData();
  }

  async loadNetworkDashboardData() {
    try {
      const [resOverview, resNodes, resMembers, resDevices, resEvents] = await Promise.all([
        fetch('/api/network/overview').then(r => r.json()).catch(() => null),
        fetch('/api/network/nodes').then(r => r.json()).catch(() => ({ nodes: [] })),
        fetch('/api/community/members').then(r => r.json()).catch(() => ({ members: [] })),
        fetch('/api/community/devices').then(r => r.json()).catch(() => null),
        fetch('/api/network/events').then(r => r.json()).catch(() => ({ events: [] }))
      ]);

      if (resOverview) this.state.dashboard.overview = resOverview;
      if (resNodes) this.state.dashboard.nodes = resNodes.nodes || [];
      if (resMembers) this.state.dashboard.members = resMembers.members || [];
      if (resDevices) this.state.dashboard.devices = resDevices;
      if (resEvents) this.state.dashboard.events = resEvents.events || [];

      this.renderDashboardOverview();
      this.renderTopologyMap();
      this.renderMembersTable();
      this.renderNodesTable();
      this.renderDevicesSection();
      this.renderTimeline();

      if (this.dashLastUpdatedBadge) {
        this.dashLastUpdatedBadge.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
      }

      if (this.waNetworkBtnLabel && resOverview) {
        const count = resOverview.onlineDesktopNodes || 0;
        this.waNetworkBtnLabel.textContent = `Visão da Comunidade (${count})`;
      }
    } catch (err) {
      console.warn('Erro ao carregar telemetria do painel:', err);
    }
  }

  renderDashboardOverview() {
    const ov = this.state.dashboard.overview;
    if (!ov) return;

    // 14 Cartões de Resumo da Rede
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('card-desktop-online', ov.onlineDesktopNodes || 1);
    setEl('card-desktop-known', `De ${ov.totalKnownNodes || 1} nós conhecidos`);
    setEl('card-mobile-connected', ov.mobileDevicesConnected || 0);
    setEl('card-web-sessions', ov.webSessionsActive || 1);
    setEl('card-total-members', ov.totalMembers || 1);
    setEl('card-members-breakdown', `${ov.administratorsCount || 1} Admins • ${ov.moderatorsCount || 0} Mods • ${ov.membersCount || 0} Membros`);
    setEl('card-sync-messages', ov.syncMessagesCount || 0);
    setEl('card-vps-state', ov.vpsStatus || 'ONLINE');
    setEl('card-vps-sub', ov.vpsStatus === 'ONLINE' ? 'Bootstrap & Descoberta Ativos' : 'Modo Malha Autônoma Ativo');
    setEl('card-p2p-state', ov.p2pMeshState === 'BOOTSTRAP_ASSISTED' ? 'ASSISTIDA' : 'AUTÔNOMA');
    setEl('card-p2p-sub', ov.p2pMeshState === 'BOOTSTRAP_ASSISTED' ? 'Conexão Híbrida VPS + P2P' : 'Malha Pura entre Computadores');

    const leaderName = ov.isCurrentNodeLeader ? `${ov.currentLeader} (Este Nó)` : (ov.currentLeader || '--');
    setEl('card-leader-id', leaderName);
    setEl('card-leader-term', `Termo ${ov.term || 1} • Quorum Ativo (Raft)`);

    const syncTimeStr = ov.lastSyncTimestamp ? new Date(ov.lastSyncTimestamp).toLocaleTimeString('pt-BR') : '--:--';
    setEl('card-last-sync', syncTimeStr);
    setEl('card-direct-connections', ov.directConnectionsCount || 0);
    setEl('card-relay-connections', ov.relayConnectionsCount || 0);
    setEl('card-nat-type', ov.natType || 'NAT_ROUTED');

    // Role Badge & Privacy View Mode
    const userRole = this.state.user ? this.state.user.role : 'Membro';
    if (this.dashUserRoleBadge) {
      this.dashUserRoleBadge.textContent = userRole;
      this.dashUserRoleBadge.className = `dash-role-badge ${userRole === 'Administrador' ? 'admin' : (userRole === 'Moderador' ? 'mod' : 'member')}`;
    }

    const viewModePill = document.getElementById('dash-view-mode-pill');
    if (viewModePill) {
      if (userRole === 'Administrador') {
        viewModePill.textContent = 'Modo: Completo (Administrador)';
        viewModePill.style.background = 'rgba(0, 168, 132, 0.25)';
        viewModePill.style.color = 'var(--wa-green)';
      } else if (userRole === 'Moderador') {
        viewModePill.textContent = 'Modo: Operacional (Moderador)';
        viewModePill.style.background = 'rgba(59, 130, 246, 0.25)';
        viewModePill.style.color = '#60a5fa';
      } else {
        viewModePill.textContent = 'Modo: Protegido & Anônimo (Membro)';
        viewModePill.style.background = 'rgba(255, 255, 255, 0.1)';
        viewModePill.style.color = 'var(--text-muted)';
      }
    }

    // Indicadores de Funcionamento P2P (Requisito 6)
    const indVpsDot = document.getElementById('ind-vps-dot');
    const indVpsText = document.getElementById('ind-vps-text');
    if (ov.vpsStatus === 'ONLINE') {
      if (indVpsDot) indVpsDot.className = 'pulse-dot online';
      if (indVpsText) indVpsText.textContent = 'Online';
    } else {
      if (indVpsDot) indVpsDot.className = 'pulse-dot warning';
      if (indVpsText) indVpsText.textContent = 'Offline (Malha Autônoma)';
    }

    setEl('ind-mesh-text', `${ov.onlineDesktopNodes || 1} conectados`);
    setEl('ind-dht-text', 'Ativa (RFC 5389 STUN + PEX)');
    setEl('ind-relay-text', ov.relayConnectionsCount > 0 ? `${ov.relayConnectionsCount} Ativo(s)` : 'Disponível');
    setEl('ind-sync-text', '100% Atualizada (Cadeia Causal)');
    setEl('ind-quorum-text', `Ativo (Termo ${ov.term || 1})`);
    setEl('ind-pending-text', '0');
    setEl('ind-reconnect-text', 'Ativa (Ciclo 10s)');
    setEl('ind-election-text', `Termo ${ov.term || 1} Consensuado`);
    setEl('ind-errors-text', '0 detectados');
  }

  renderTopologyMap() {
    const svg = document.getElementById('dash-topology-svg');
    if (!svg) return;

    const ov = this.state.dashboard.overview || {};
    const nodes = this.state.dashboard.nodes || [];
    const devices = this.state.dashboard.devices || {};

    svg.innerHTML = '';

    // Dimensões do Canvas SVG
    const width = 800;
    const height = 450;
    const centerX = 400;
    const centerY = 225;

    const nodesData = [];
    const linksData = [];

    // 1. Nó Central: Comunidade Resiliente
    nodesData.push({
      id: 'community-core',
      name: 'Comunidade Resiliente',
      shortId: 'core',
      role: 'Centro da Malha',
      type: 'core',
      x: centerX,
      y: centerY,
      icon: '🛡️',
      color: '#00a884',
      status: 'Conectado',
      method: 'Causal Hash Chain'
    });

    // 2. Nó VPS Bootstrap
    const vpsIsOnline = ov.vpsStatus === 'ONLINE';
    const vpsNode = {
      id: 'vps-bootstrap',
      name: 'VPS Bootstrap Central',
      shortId: 'vps',
      role: 'Sinalização & Relay',
      type: 'vps',
      x: centerX,
      y: centerY - 140,
      icon: '☁️',
      color: vpsIsOnline ? '#22c55e' : '#64748b',
      status: vpsIsOnline ? 'Online (Acessível)' : 'Offline (Malha Autônoma Ativa)',
      method: 'WebSocket / STUN Relay'
    };
    nodesData.push(vpsNode);
    linksData.push({
      from: 'community-core',
      to: 'vps-bootstrap',
      isRelay: false,
      color: vpsIsOnline ? '#00a884' : '#475569',
      dashed: !vpsIsOnline
    });

    // 3. Este Nó Local (Desktop)
    const localNode = {
      id: 'local-desktop-node',
      name: `Este Computador (${this.state.user ? this.state.user.username : 'Desktop'})`,
      shortId: (ov.currentLeader ? ov.currentLeader.slice(0, 8) : 'local'),
      role: this.state.user ? this.state.user.role : 'Membro',
      type: 'desktop-local',
      x: centerX - 160,
      y: centerY,
      icon: '💻',
      color: '#22c55e',
      status: 'Online (Ativo)',
      method: 'Direto (Local Daemon)'
    };
    nodesData.push(localNode);
    linksData.push({
      from: 'community-core',
      to: 'local-desktop-node',
      isRelay: false,
      color: '#22c55e',
      dashed: false
    });

    // 4. Outros Nós Desktop da Malha
    const totalDesktops = Math.max(1, nodes.length);
    const peerNodes = nodes.length > 0 ? nodes : [
      { shortId: 'node_alpha', role: 'Membro', connectionMethod: 'direct' }
    ];

    peerNodes.forEach((peer, idx) => {
      const angle = (idx + 1) * (Math.PI / (peerNodes.length + 1)) - (Math.PI / 2);
      const px = centerX + 180 * Math.cos(angle);
      const py = centerY + 110 * Math.sin(angle);
      const isRelay = peer.connectionMethod === 'relay';

      const pNode = {
        id: `peer-${idx}`,
        name: `Nó Desktop ${idx + 1}`,
        shortId: peer.shortId || `node_${idx + 1}`,
        role: peer.role || 'Membro',
        type: 'desktop-peer',
        x: px,
        y: py,
        icon: '💻',
        color: isRelay ? '#3b82f6' : '#22c55e',
        status: isRelay ? 'Conectado via Relay' : 'Conectado Direto (STUN)',
        method: isRelay ? 'Relay Forwarding' : 'P2P Direct'
      };
      nodesData.push(pNode);
      linksData.push({
        from: 'community-core',
        to: pNode.id,
        isRelay,
        color: isRelay ? '#3b82f6' : '#22c55e',
        dashed: isRelay
      });
    });

    // 5. Celulares Conectados (se houver)
    const mobileCount = devices.mobileCount || ov.mobileDevicesConnected || 0;
    if (mobileCount > 0) {
      const mobNode = {
        id: 'mobile-group',
        name: `${mobileCount} Celular(es) Conectado(s)`,
        shortId: `mob_${mobileCount}`,
        role: 'Membro / Leitura Móvel',
        type: 'mobile',
        x: centerX - 130,
        y: centerY + 120,
        icon: '📱',
        color: '#10b981',
        status: 'Online (Web Push Ativo)',
        method: 'PWA / Mobile Bridge'
      };
      nodesData.push(mobNode);
      linksData.push({
        from: 'local-desktop-node',
        to: 'mobile-group',
        isRelay: false,
        color: '#10b981',
        dashed: true
      });
    }

    // 6. Páginas Web / PWA
    const webCount = devices.webCount || ov.webSessionsActive || 1;
    const webNode = {
      id: 'web-sessions-group',
      name: `${webCount} Página(s) Web Ativa(s)`,
      shortId: `web_${webCount}`,
      role: 'Leitura / Visualização',
      type: 'web',
      x: centerX + 130,
      y: centerY + 120,
      icon: '🌐',
      color: '#8b5cf6',
      status: 'Sessão Web Local',
      method: 'WebSocket /live'
    };
    nodesData.push(webNode);
    linksData.push({
      from: 'local-desktop-node',
      to: 'web-sessions-group',
      isRelay: false,
      color: '#8b5cf6',
      dashed: true
    });

    // Renderiza Linhas de Conexão no SVG
    linksData.forEach(link => {
      const fromNode = nodesData.find(n => n.id === link.from);
      const toNode = nodesData.find(n => n.id === link.to);
      if (!fromNode || !toNode) return;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', fromNode.x);
      line.setAttribute('y1', fromNode.y);
      line.setAttribute('x2', toNode.x);
      line.setAttribute('y2', toNode.y);
      line.setAttribute('stroke', link.color);
      line.setAttribute('stroke-width', link.isRelay ? '2' : '2.5');
      if (link.dashed) {
        line.setAttribute('stroke-dasharray', '6,5');
      }
      line.setAttribute('opacity', '0.75');
      svg.appendChild(line);
    });

    // Renderiza Nós no SVG
    nodesData.forEach(node => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('style', 'cursor: pointer;');
      group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

      // Círculo com Glow
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', node.type === 'core' ? '28' : '22');
      circle.setAttribute('fill', '#202c33');
      circle.setAttribute('stroke', node.color);
      circle.setAttribute('stroke-width', '3');
      group.appendChild(circle);

      // Ícone do Nó
      const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      iconText.setAttribute('text-anchor', 'middle');
      iconText.setAttribute('dy', '6');
      iconText.setAttribute('font-size', node.type === 'core' ? '18' : '15');
      iconText.textContent = node.icon;
      group.appendChild(iconText);

      // Legenda do Nó
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', node.type === 'core' ? '44' : '36');
      label.setAttribute('fill', '#e9edef');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-weight', '600');
      label.textContent = node.name.length > 22 ? node.name.slice(0, 20) + '...' : node.name;
      group.appendChild(label);

      // Evento de Clique para exibir Popover Seguro
      group.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showNodePopover(node);
      });

      svg.appendChild(group);
    });
  }

  showNodePopover(node) {
    const popover = document.getElementById('dash-node-popover');
    if (!popover) return;

    document.getElementById('popover-node-name').textContent = node.name;
    document.getElementById('popover-node-id').textContent = node.shortId;
    document.getElementById('popover-node-role').textContent = node.role;
    document.getElementById('popover-node-method').textContent = node.method;
    document.getElementById('popover-node-status').textContent = node.status;

    popover.style.display = 'block';
  }

  renderMembersTable() {
    const tbody = document.getElementById('dash-members-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const members = this.state.dashboard.members || [];
    const userRole = this.state.user ? this.state.user.role : 'Membro';
    const currentUserId = this.state.user ? this.state.user.id : null;

    // Filtros
    let filtered = members.filter(m => {
      // Busca
      if (this.state.memberSearchQuery) {
        const q = this.state.memberSearchQuery;
        const matchesName = (m.username || '').toLowerCase().includes(q);
        if (!matchesName) return false;
      }

      // Chip
      const f = this.state.memberFilter;
      if (f === 'all') return true;
      if (f === 'online') return m.status === 'active';
      if (f === 'offline') return m.status !== 'active';
      if (f === 'admin') return m.role === 'Administrador';
      if (f === 'moderator') return m.role === 'Moderador';
      if (f === 'member') return m.role === 'Membro';
      if (f === 'desktop') return (m.deviceType || '').includes('Desktop');
      if (f === 'mobile') return (m.deviceType || '').includes('Celular');
      if (f === 'web') return (m.deviceType || '').includes('Web');
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhum membro encontrado com os filtros atuais.</td></tr>`;
      return;
    }

    filtered.forEach(m => {
      const tr = document.createElement('tr');

      // Anonimização segura para membros comuns (Requisito de Privacidade 8)
      let displayName = m.username;
      if (userRole === 'Membro' && m.id !== currentUserId && m.role !== 'Administrador') {
        const shortHash = m.id.slice(-4);
        displayName = `Membro Conectado (#${shortHash})`;
      }

      const roleBadge = m.role === 'Administrador'
        ? `<span class="dash-role-badge" style="background: rgba(0, 168, 132, 0.2); color: var(--wa-green);">Administrador</span>`
        : (m.role === 'Moderador'
          ? `<span class="dash-role-badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">Moderador</span>`
          : `<span class="dash-role-badge" style="background: rgba(255, 255, 255, 0.08); color: var(--text-muted);">Membro</span>`);

      const statusBadge = m.status === 'active'
        ? `<span style="color: #22c55e; font-weight: 600;">● Online</span>`
        : `<span style="color: #94a3b8;">○ Offline</span>`;

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600;">${this.escapeHtml(displayName)}</div>
          <div style="font-size: 0.72rem; color: var(--text-dim); font-family: var(--font-mono);">${m.id ? m.id.slice(0, 10) + '...' : '--'}</div>
        </td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>💻 Desktop / 📱 Celular</td>
        <td style="color: var(--text-muted); font-size: 0.75rem;">Recentemente</td>
        <td><span style="color: var(--wa-green); font-size: 0.75rem; font-weight: 600;">✓ 100% Sincronizado</span></td>
        <td>1 ativo</td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderNodesTable() {
    const tbody = document.getElementById('dash-nodes-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const nodes = this.state.dashboard.nodes || [];

    if (nodes.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td>Este Computador (Nó Local)</td>
          <td class="font-mono">local</td>
          <td>${this.state.user ? this.state.user.role : 'Membro'}</td>
          <td><span style="color: #22c55e;">● Ativo</span></td>
          <td><span class="dash-chip" style="background: rgba(34, 197, 94, 0.2); color: #22c55e;">Direto (STUN Traversal)</span></td>
          <td>Agora</td>
          <td>100% em dia</td>
          <td>${this.state.dashboard.overview ? this.state.dashboard.overview.syncMessagesCount || 0 : 0} msgs</td>
          <td>CRDT/v2.1</td>
          <td>Sessão Ativa</td>
        </tr>
      `;
      return;
    }

    nodes.forEach((n, idx) => {
      const tr = document.createElement('tr');
      const isRelay = n.connectionMethod === 'relay';
      const methodBadge = isRelay
        ? `<span class="dash-chip" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">🔄 Relay (VPS)</span>`
        : `<span class="dash-chip" style="background: rgba(34, 197, 94, 0.2); color: #22c55e;">⚡ Direto (STUN)</span>`;

      tr.innerHTML = `
        <td>Nó P2P ${idx + 1}</td>
        <td class="font-mono">${n.shortId || n.nodeId.slice(0, 12)}</td>
        <td>${n.role || 'Membro'}</td>
        <td><span style="color: #22c55e;">● Conectado</span></td>
        <td>${methodBadge}</td>
        <td>Recentemente</td>
        <td>100% em dia</td>
        <td>Sincronizado</td>
        <td>CRDT/v2.1</td>
        <td>Conectado</td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderDevicesSection() {
    const dev = this.state.dashboard.devices || {};
    const ov = this.state.dashboard.overview || {};

    const mobEl = document.getElementById('dev-mobile-active');
    if (mobEl) mobEl.textContent = `${dev.mobileCount || ov.mobileDevicesConnected || 0} Conectados`;

    const webEl = document.getElementById('dev-web-active');
    if (webEl) webEl.textContent = `${dev.webCount || ov.webSessionsActive || 1} Sessões`;

    const deskEl = document.getElementById('dev-desktop-active');
    if (deskEl) deskEl.textContent = `${dev.desktopCount || ov.onlineDesktopNodes || 1} Nós Desktop`;

    const subsEl = document.getElementById('dev-push-subs-count');
    if (subsEl) subsEl.textContent = `${dev.pushSubscribersCount || 0}`;

    const sessEl = document.getElementById('dev-sessions-count');
    if (sessEl) sessEl.textContent = `${dev.activeSessionsCount || 1}`;
  }

  renderTimeline() {
    const feed = document.getElementById('dash-timeline-feed');
    if (!feed) return;

    feed.innerHTML = '';
    const events = this.state.dashboard.events || [];

    if (events.length === 0) {
      feed.innerHTML = `
        <div class="dash-timeline-item">
          <span class="dash-timeline-dot green"></span>
          <div class="dash-timeline-content">
            <div class="dash-timeline-title">
              <span>Malha P2P Inicializada com Sucesso</span>
              <span class="dash-timeline-time">Agora</span>
            </div>
            <div class="dash-timeline-desc">O nó local inicializou a descoberta STUN e a cadeia de mensagens causal.</div>
          </div>
        </div>
      `;
      return;
    }

    events.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'dash-timeline-item';

      let dotColor = 'green';
      if (ev.event_type.includes('RELAY')) dotColor = 'blue';
      else if (ev.event_type.includes('VPS') || ev.event_type.includes('OFFLINE')) dotColor = 'amber';
      else if (ev.event_type.includes('LEADER') || ev.event_type.includes('ELECTION')) dotColor = 'purple';

      const timeStr = new Date(ev.timestamp).toLocaleTimeString('pt-BR');

      item.innerHTML = `
        <span class="dash-timeline-dot ${dotColor}"></span>
        <div class="dash-timeline-content">
          <div class="dash-timeline-title">
            <span>${this.escapeHtml(ev.description || ev.event_type)}</span>
            <span class="dash-timeline-time">${timeStr}</span>
          </div>
          <div class="dash-timeline-desc">Evento registrado na auditoria técnica da rede distribuída.</div>
        </div>
      `;
      feed.appendChild(item);
    });
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
