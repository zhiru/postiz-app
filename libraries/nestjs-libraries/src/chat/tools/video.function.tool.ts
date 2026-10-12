import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import z from 'zod';
import { ModuleRef } from '@nestjs/core';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class VideoFunctionTool implements AgentToolInterface {
  constructor(
    private _videoManagerService: VideoManager,
    private _moduleRef: ModuleRef
  ) {}
  name = 'videoFunctionTool';

  run() {
    return createTool({
      id: 'videoFunctionTool',
      description: `Runs a helper function of a video generator, e.g. listing the generator's
                    available voices and returning a voice_id to use in generateVideoTool's customParams.
                    'identifier' and 'functionName' come from a generator's 'tools' entry returned by
                    'generateVideoOptions'. Returns whatever the helper function returns, or throws
                    "Function not found" if no generator exposes that identifier/functionName pair.`,
      mcp: {
        annotations: {
          title: 'Video Function Helper',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        identifier: z
          .string()
          .describe(
            "The video generator's identifier, from a 'tools' entry returned by generateVideoOptions"
          ),
        functionName: z
          .string()
          .describe(
            "The helper function's name, from the same 'tools' entry returned by generateVideoOptions"
          ),
      }),
      outputSchema: z.object({}).passthrough(),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const videos = this._videoManagerService.getAllVideos();
        const findVideo = videos.find(
          (p) =>
            p.identifier === inputData.identifier &&
            p.tools.some((p) => p.functionName === inputData.functionName)
        );

        if (!findVideo) {
          throw new Error('Function not found');
        }

        const func = await this._moduleRef
          // @ts-ignore
          .get(findVideo.target, { strict: false })
          [inputData.functionName]();
        return func;
      },
    });
  }
}
