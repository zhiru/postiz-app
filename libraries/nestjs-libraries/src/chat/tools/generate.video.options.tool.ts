import {
  AgentToolInterface,
} from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class GenerateVideoOptionsTool implements AgentToolInterface {
  constructor(private _videoManagerService: VideoManager) {}
  name = 'generateVideoOptions';

  run() {
    return createTool({
      id: 'generateVideoOptions',
      description: `Lists the available video generators, use this before calling 'generateVideoTool'.
                    Each entry has: 'type' (the identifier to pass as generateVideoTool's 'identifier'),
                    'output' (the supported orientations, always "vertical|horizontal"),
                    'customParams' (the extra settings this generator accepts, pass as generateVideoTool's 'customParams'),
                    and 'tools' (helper functions, e.g. to list available voices and get a voice_id,
                    that must be called through 'videoFunctionTool' before generating, if the generator needs them).`,
      inputSchema: z.object({
        reasoning: z
          .string()
          .optional()
          .describe(
            'Optional short reason for why you are listing the video generation options'
          ),
      }),
      mcp: {
        annotations: {
          title: 'List Video Generation Options',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        video: z.array(
          z.object({
            type: z.string(),
            output: z.string(),
            tools: z.array(
              z.object({
                functionName: z.string(),
                output: z.string(),
              })
            ),
            customParams: z.any(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const videos = this._videoManagerService.getAllVideos();
        console.log(
          JSON.stringify(
            {
              video: videos.map((p) => {
                return {
                  type: p.identifier,
                  output: 'vertical|horizontal',
                  tools: p.tools,
                  customParams: getValidationSchemas()[p.dto.name],
                };
              }),
            },
            null,
            2
          )
        );

        return {
          video: videos.map((p) => {
            return {
              type: p.identifier,
              output: 'vertical|horizontal',
              tools: p.tools,
              customParams: getValidationSchemas()[p.dto.name],
            };
          }),
        };
      },
    });
  }
}
