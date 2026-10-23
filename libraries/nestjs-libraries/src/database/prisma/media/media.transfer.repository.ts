import { Injectable } from '@nestjs/common';
import { PrismaTransaction } from '../prisma.service';
import { MediaTransferManifest } from '@gitroom/nestjs-libraries/dtos/media/media.transfer.dto';

export type TransferState = {
  version: 1;
  manifest: MediaTransferManifest;
  status: 'prepared' | 'uploading' | 'stored' | 'failed' | 'unknown';
  mediaId?: string;
  startedAt?: number;
  errorCode?: string;
};
export type TransferScope = {
  id: string;
  organizationId: string;
  profileId: string | null;
};
export type TransferRecord = TransferScope & {
  requestHash: string;
  result: string | null;
};

@Injectable()
export class MediaTransferRepository {
  constructor(private transaction: PrismaTransaction) {}

  async reserve(
    scope: TransferScope,
    requestHash: string,
    state: TransferState
  ) {
    try {
      return await this.transaction.model.$transaction((tx) =>
        tx.postOperation.create({
          data: { ...scope, requestHash, result: JSON.stringify(state) },
          select: {
            id: true,
            organizationId: true,
            profileId: true,
            requestHash: true,
            result: true,
          },
        })
      );
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return this.find(scope);
    }
  }

  find(scope: TransferScope) {
    return this.transaction.model.$transaction((tx) =>
      tx.postOperation.findFirst({
        where: scope,
        select: {
          id: true,
          organizationId: true,
          profileId: true,
          requestHash: true,
          result: true,
        },
      })
    );
  }

  transition(record: TransferRecord, state: TransferState) {
    return this.transaction.model.$transaction((tx) =>
      tx.postOperation.updateMany({
        where: {
          id: record.id,
          organizationId: record.organizationId,
          profileId: record.profileId,
          result: record.result,
        },
        data: { result: JSON.stringify(state) },
      })
    );
  }

  // The media row and its replay receipt commit together. A lost response cannot
  // leave a successful upload without the media id needed for reconciliation.
  save(
    record: TransferRecord,
    state: TransferState,
    file: {
      id: string;
      name: string;
      path: string;
      sizeBytes: number;
      mimeType: string;
    }
  ) {
    return this.transaction.model.$transaction(async (tx) => {
      const changed = await tx.postOperation.updateMany({
        where: {
          id: record.id,
          organizationId: record.organizationId,
          profileId: record.profileId,
          result: record.result,
        },
        data: {
          result: JSON.stringify({
            ...state,
            status: 'stored',
            mediaId: file.id,
          }),
        },
      });
      if (changed.count !== 1) throw new Error('Upload receipt changed');
      return tx.media.create({
        data: {
          id: file.id,
          organizationId: record.organizationId,
          profileId: record.profileId,
          name: file.name,
          path: file.path,
          originalName: state.manifest.filename,
          originalPath: file.path,
          fileSize: file.sizeBytes,
          type: file.mimeType.startsWith('video/') ? 'video' : 'image',
          status: state.manifest.adjust ? 'processing' : 'ready',
        },
        select: {
          id: true,
          name: true,
          path: true,
          originalPath: true,
          status: true,
        },
      });
    });
  }
}
