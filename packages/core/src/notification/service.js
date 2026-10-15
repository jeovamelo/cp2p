/**
 * Serviço de Notificações com Preservação de Privacidade (Zero-Knowledge Push)
 * Compatível com Web Push, PWA e simulação FCM/APNs.
 */

export class NotificationService {
  constructor(db) {
    this.db = db;
    this.subscriptions = new Map(); // userId -> pushSubscription
  }

  registerSubscription(userId, subscription) {
    this.subscriptions.set(userId, subscription);
  }

  /**
   * Prepara uma notificação sem vazar o conteúdo confidencial da mensagem.
   */
  dispatchForMessage(message, communityName = 'Comunidade') {
    const title = `Mensagem em ${communityName}`;
    // Nunca inclui texto privado na notificação push sem decifração local
    const body = `Nova mensagem criptografada disponível (#${message.sequence})`;

    const notificationPayload = {
      id: `notif_${message.id}`,
      communityId: message.communityId,
      messageId: message.id,
      sequence: message.sequence,
      title,
      body,
      timestamp: message.timestamp,
      data: {
        hash: message.hash,
        hasAttachments: message.metadata?.hasAttachments || false
      }
    };

    // Armazena na fila local caso o destino esteja offline
    this.db.enqueueNotification(notificationPayload);

    return notificationPayload;
  }

  /**
   * Envia ou simula o envio de notificações pendentes.
   */
  flushPendingQueue(sendFn) {
    const pending = this.db.getPendingNotifications();
    const sent = [];

    for (const notif of pending) {
      if (sendFn) {
        try {
          sendFn(notif);
          this.db.markNotificationDelivered(notif.id);
          sent.push(notif);
        } catch (err) {
          console.warn(`[NotificationService] Falha ao entregar notificação ${notif.id}:`, err.message);
        }
      } else {
        // Modo local de simulação
        this.db.markNotificationDelivered(notif.id);
        sent.push(notif);
      }
    }

    return sent;
  }
}
