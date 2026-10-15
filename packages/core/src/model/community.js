import { CryptoEngine } from '../crypto/keys.js';

export const UserRoles = {
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
  MEMBER: 'MEMBER'
};

export class CommunityModel {
  static create({
    id,
    name,
    description = '',
    adminPublicKey,
    adminPrivateKey = null,
    initialEpoch = 1
  }) {
    if (!id || !name || !adminPublicKey) {
      throw new Error('Parâmetros obrigatórios ausentes para criar comunidade');
    }

    const initialKey = CryptoEngine.generateCommunityKey();
    const timestamp = Date.now();

    const community = {
      id,
      name,
      description,
      adminPublicKey,
      currentEpoch: initialEpoch,
      epochs: {
        [initialEpoch]: {
          keyHex: initialKey,
          createdAt: timestamp
        }
      },
      members: [
        {
          publicKey: adminPublicKey,
          role: UserRoles.ADMIN,
          joinedAt: timestamp,
          status: 'ACTIVE'
        }
      ],
      moderators: [],
      authorizedAdmins: [adminPublicKey],
      settings: {
        moderatorsCanPublish: false,
        requireQuorumForRevocation: true,
        quorumPercentage: 51
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };

    return community;
  }

  /**
   * Adiciona um novo membro à comunidade com um papel específico.
   */
  static addMember(community, { publicKey, role = UserRoles.MEMBER, displayName = '' }) {
    const cleanKey = publicKey.replace(/\s+/g, '');
    const existingIndex = community.members.findIndex(m => m.publicKey.replace(/\s+/g, '') === cleanKey);

    const memberRecord = {
      publicKey,
      displayName: displayName || `Membro_${cleanKey.slice(0, 8)}`,
      role,
      joinedAt: Date.now(),
      status: 'ACTIVE'
    };

    if (existingIndex >= 0) {
      community.members[existingIndex] = memberRecord;
    } else {
      community.members.push(memberRecord);
    }

    if (role === UserRoles.ADMIN && !community.authorizedAdmins.some(k => k.replace(/\s+/g, '') === cleanKey)) {
      community.authorizedAdmins.push(publicKey);
    } else if (role === UserRoles.MODERATOR && !community.moderators.some(k => k.replace(/\s+/g, '') === cleanKey)) {
      community.moderators.push(publicKey);
    }

    community.updatedAt = Date.now();
    return memberRecord;
  }

  /**
   * Remove/revoga um membro da comunidade e dispara rotação da chave comunitária (Forward Secrecy).
   */
  static revokeMember(community, publicKeyToRevoke) {
    const cleanKey = publicKeyToRevoke.replace(/\s+/g, '');
    const member = community.members.find(m => m.publicKey.replace(/\s+/g, '') === cleanKey);

    if (!member) {
      throw new Error('Membro não encontrado na comunidade');
    }

    if (member.role === UserRoles.ADMIN && community.authorizedAdmins.length <= 1) {
      throw new Error('Não é possível revogar o único Administrador da comunidade');
    }

    member.status = 'REVOKED';
    member.revokedAt = Date.now();

    // Remove das listas de administradores e moderadores
    community.authorizedAdmins = community.authorizedAdmins.filter(k => k.replace(/\s+/g, '') !== cleanKey);
    community.moderators = community.moderators.filter(k => k.replace(/\s+/g, '') !== cleanKey);

    // Rotação de Chave (Novo Ciclo / Epoch Ratchet)
    const activeMembers = community.members.filter(m => m.status === 'ACTIVE');
    const rotation = CryptoEngine.rotateCommunityEpoch(community.id, community.currentEpoch, activeMembers);

    community.currentEpoch = rotation.epoch;
    community.epochs[rotation.epoch] = {
      keyHex: rotation.keyHex,
      createdAt: rotation.rotatedAt
    };
    community.updatedAt = Date.now();

    return {
      revokedMember: member,
      newEpoch: rotation.epoch,
      activeMembersCount: activeMembers.length
    };
  }

  /**
   * Obtém a chave simétrica do ciclo/epoch solicitado.
   */
  static getEpochKey(community, epochNumber) {
    const epochData = community.epochs[epochNumber || community.currentEpoch];
    return epochData ? epochData.keyHex : null;
  }
}
