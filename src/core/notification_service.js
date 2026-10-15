/**
 * Comunidade Resiliente - Serviço de Notificações Push Seguras e PWA
 * Compatível com Web Push, FCM e fila offline com proteção de privacidade
 */

const EventEmitter = require('events');

class NotificationService extends EventEmitter {
  /**
   * @param {import('./storage')} storageManager
   */
  constructor(storageManager) {
    super();
    this.storage = storageManager;
    this.activeSubscriptions = new Set(); // Conexões SSE ou Web Push subscriptions ativas
  }

  /**
   * Formata e despacha uma notificação segura
   * Regra de Privacidade: NUNCA envia o texto confidencial completo no push aberto
   * @param {object} message - Mensagem recém-recebida e validada
   * @param {string} communityName - Nome da comunidade
   */
  dispatchForMessage(message, communityName = 'Comunidade Resiliente') {
    const title = `Novo comunicado: ${communityName}`;
    const body = `Publicação oficial #${message.sequence} recebida e verificada via rede P2P.`;

    const notificationPayload = {
      messageId: message.id,
      sequence: message.sequence,
      communityId: message.community_id,
      title,
      body,
      timestamp: message.timestamp,
      requiresDecryption: true
    };

    // 1. Armazena no banco local como notificação pendente / histórico
    this.storage.addPendingNotification(message.id, title, body);

    // 2. Emite evento para os clientes locais (Web/PWA/Desktop)
    this.emit('push', notificationPayload);

    // 3. Simulação de envio para FCM / Web Push
    this.sendToPushGateway(notificationPayload);

    return notificationPayload;
  }

  /**
   * Simulação de envio para provedores externos de push (Firebase Cloud Messaging / APNs / WebPush)
   */
  sendToPushGateway(payload) {
    // Em um ambiente de produção com chaves FCM/VAPID configuradas,
    // os pacotes são enviados criptografados para o gateway do Google/Apple.
    // Aqui garantimos que o envelope nunca expõe a chave ou o texto decifrado.
    const fcmMessage = {
      notification: {
        title: payload.title,
        body: payload.body
      },
      data: {
        message_id: payload.messageId,
        sequence: String(payload.sequence),
        community_id: payload.communityId,
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      },
      android: {
        priority: 'high'
      },
      apns: {
        headers: {
          'apns-priority': '10'
        },
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.body
            },
            sound: 'default'
          }
        }
      }
    };

    return fcmMessage;
  }

  /**
   * Processa notificações pendentes quando o nó volta a ficar online
   */
  flushPendingQueue() {
    const pending = this.storage.getPendingNotifications();
    for (const item of pending) {
      this.emit('push', {
        id: item.id,
        messageId: item.message_id,
        title: item.title,
        body: item.body,
        fromOfflineQueue: true
      });
      this.storage.markNotificationDelivered(item.id);
    }
    return pending.length;
  }
}

module.exports = NotificationService;
